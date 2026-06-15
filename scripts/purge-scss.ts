/**
 * PurgeCSS for SCSS — 分析未使用的 CSS 选择器并映射回 SCSS 源码
 *
 * Usage:
 *   bun scripts/purge-scss.ts            扫描 SCSS，输出 purge-scss-report.txt
 *   bun scripts/purge-scss.ts --verbose  同上，但在控制台输出每个被移除的选择器详情
 */

import * as sass from 'sass';
import { PurgeCSS } from 'purgecss';
import postcss from 'postcss';
import { SourceMapConsumer } from 'source-map-js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, relative, basename, extname } from 'path';
import { Glob } from 'bun';

const ROOT = resolve(import.meta.dir, '..');
const REPORT_FILE = resolve(ROOT, 'purge-scss.md');
const VERBOSE = process.argv.includes('--verbose');

// ─── config ────────────────────────────────────────────────────────────────

const SCSS_GLOBS = [
  'src/renderer/styles/**/*.scss',
  'src/renderer/components/**/*.scss',
];

const CSS_GLOBS = [
  'src/renderer/styles/**/*.css',
];

const CONTENT_GLOBS = [
  'src/renderer/**/*.tsx',
  'src/renderer/**/*.ts',
  'src/renderer/**/*.html',
];

const SAFELIST = {
  standard: [] as string[],
  deep: [] as RegExp[],
  greedy: [
    /^file-type-icon--/,
    /^experiment-tag-/,
    /^rc-status-/,
    /^status-(resolved|rejected|expired|skipped)/,
    /^segment-/,
  ],
};

function defaultExtractor(content: string): string[] {
  const standard = content.match(/[\w-/:.]+(?<!:)/g) || [];
  const templatePrefixes = content.match(/[\w-]+(?=\$\{)/g) || [];
  return [...new Set([...standard, ...templatePrefixes])];
}

// ─── helpers ───────────────────────────────────────────────────────────────

function globSync(pattern: string, cwd: string): string[] {
  const g = new Glob(pattern);
  return [...g.scanSync({ cwd, absolute: true })];
}

function isPartial(filePath: string): boolean {
  return basename(filePath).startsWith('_');
}

interface SourceLocation {
  scssFile: string;
  line: number;
}

interface RejectedSelector {
  selector: string;
  sources: SourceLocation[];
}

interface FileReport {
  relPath: string;
  originalSize: number;
  purgedSize: number;
  reduction: number;
  rejectedSelectors: RejectedSelector[];
  error?: string;
}

// ─── source map lookup ─────────────────────────────────────────────────────

function normalizeSelector(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function findSelectorInCss(cssText: string, selector: string): { line: number; column: number } | null {
  const normalized = normalizeSelector(selector);
  try {
    const root = postcss.parse(cssText);
    const walk = (nodes: postcss.ChildNode[]): { line: number; column: number } | null => {
      for (const node of nodes) {
        if (node.type === 'rule' && node.source?.start) {
          const parts = node.selector.split(',').map(normalizeSelector);
          if (normalizeSelector(node.selector) === normalized || parts.includes(normalized)) {
            return { line: node.source.start.line, column: node.source.start.column - 1 };
          }
        }
        if ('nodes' in node && node.nodes) {
          const found = walk(node.nodes);
          if (found) return found;
        }
      }
      return null;
    };
    return walk(root.nodes ?? []);
  } catch {
    return null;
  }
}

function mapToScss(
  consumer: SourceMapConsumer,
  cssLine: number,
  cssColumn: number,
  compiledFrom: string,
): SourceLocation {
  const pos = consumer.originalPositionFor({ line: cssLine, column: cssColumn });
  if (pos.source && pos.line != null) {
    const scssFile = pos.source.startsWith('file://')
      ? pos.source.replace(/^file:\/\//, '')
      : resolve(compiledFrom, '..', pos.source);
    return { scssFile: relative(ROOT, scssFile), line: pos.line };
  }
  return { scssFile: relative(ROOT, compiledFrom), line: cssLine };
}

// ─── compile scss ──────────────────────────────────────────────────────────

interface CompileResult {
  absPath: string;
  css: string;
  sourceMap: RawSourceMap | null;
}

type RawSourceMap = {
  version: string;
  sources: string[];
  names: string[];
  mappings: string;
  sourcesContent?: string[];
};

function compileScssFile(absPath: string): CompileResult | null {
  try {
    const result = sass.compile(absPath, {
      sourceMap: true,
      sourceMapIncludeSources: true,
      style: 'expanded',
      silenceDeprecations: [],
    });
    return {
      absPath,
      css: result.css,
      sourceMap: result.sourceMap || null,
    };
  } catch (err: any) {
    console.error(`  SCSS compile error: ${relative(ROOT, absPath)}: ${err.message.split('\n')[0]}`);
    return null;
  }
}

// ─── analyze a single file ─────────────────────────────────────────────────

async function analyzeFile(
  css: string,
  sourceMap: RawSourceMap | null,
  absPath: string,
  contentEntries: { raw: string; extension: string }[],
): Promise<FileReport> {
  const relPath = relative(ROOT, absPath);
  const originalSize = Buffer.byteLength(css, 'utf-8');

  try {
    const results = await new PurgeCSS().purge({
      content: contentEntries,
      css: [{ raw: css }],
      safelist: SAFELIST,
      defaultExtractor,
      rejected: true,
      keyframes: true,
      variables: true,
      fontFace: true,
    });

    const result = results[0];
    const purgedSize = Buffer.byteLength(result.css, 'utf-8');
    const reduction = originalSize > 0 ? (1 - purgedSize / originalSize) * 100 : 0;
    const rejectedList = result.rejected ?? [];

    const rejectedSelectors: RejectedSelector[] = [];

    if (rejectedList.length > 0) {
      const consumer = sourceMap ? new SourceMapConsumer(sourceMap as any) : null;
      for (const selector of rejectedList) {
        const pos = findSelectorInCss(css, selector);
        if (pos && consumer) {
          const loc = mapToScss(consumer, pos.line, pos.column, absPath);
          rejectedSelectors.push({ selector, sources: [loc] });
        } else if (pos) {
          rejectedSelectors.push({
            selector,
            sources: [{ scssFile: relative(ROOT, absPath), line: pos.line }],
          });
        } else {
          rejectedSelectors.push({ selector, sources: [] });
        }
      }
    }

    return { relPath, originalSize, purgedSize, reduction: +reduction.toFixed(1), rejectedSelectors };
  } catch (err: any) {
    return {
      relPath,
      originalSize,
      purgedSize: originalSize,
      reduction: 0,
      rejectedSelectors: [],
      error: err.message,
    };
  }
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('PurgeCSS for SCSS — Analysis');
  console.log('============================\n');

  // Collect content files
  const contentFiles: string[] = [];
  for (const pattern of CONTENT_GLOBS) {
    contentFiles.push(...globSync(pattern, ROOT));
  }
  console.log(`Content files: ${contentFiles.length}`);

  const contentEntries = contentFiles.map((f) => ({
    raw: readFileSync(f, 'utf-8'),
    extension: extname(f).slice(1),
  }));

  // Collect and compile SCSS files (skip partials)
  const scssFiles: string[] = [];
  for (const pattern of SCSS_GLOBS) {
    scssFiles.push(...globSync(pattern, ROOT));
  }
  const nonPartials = scssFiles.filter((f) => !isPartial(f));
  console.log(`SCSS files: ${scssFiles.length} total, ${nonPartials.length} non-partial to analyze`);

  // Collect plain CSS files
  const cssFiles: string[] = [];
  for (const pattern of CSS_GLOBS) {
    cssFiles.push(...globSync(pattern, ROOT));
  }
  console.log(`CSS files: ${cssFiles.length}`);
  console.log('');

  // Compile SCSS
  console.log('Compiling SCSS...');
  const compiled: CompileResult[] = [];
  for (const f of nonPartials) {
    const result = compileScssFile(f);
    if (result) compiled.push(result);
  }
  console.log(`Successfully compiled: ${compiled.length}/${nonPartials.length}\n`);

  // Analyze compiled SCSS
  console.log('Analyzing unused selectors...\n');
  const reports: FileReport[] = [];

  for (const { absPath, css, sourceMap } of compiled) {
    const report = await analyzeFile(css, sourceMap, absPath, contentEntries);
    reports.push(report);

    if (report.reduction > 0 || report.error) {
      const sizeLabel = `${(report.originalSize / 1024).toFixed(1)}KB → ${(report.purgedSize / 1024).toFixed(1)}KB`;
      const tag = report.error ? 'ERROR' : `-${report.reduction}%`;
      console.log(`  ${report.relPath}: ${sizeLabel}  ${tag}`);
    }
  }

  // Analyze plain CSS files
  for (const cssFile of cssFiles) {
    const rawCss = readFileSync(cssFile, 'utf-8');
    const report = await analyzeFile(rawCss, null, cssFile, contentEntries);
    reports.push(report);

    if (report.reduction > 0 || report.error) {
      const sizeLabel = `${(report.originalSize / 1024).toFixed(1)}KB → ${(report.purgedSize / 1024).toFixed(1)}KB`;
      const tag = report.error ? 'ERROR' : `-${report.reduction}%`;
      console.log(`  ${report.relPath}: ${sizeLabel}  ${tag}`);
    }
  }

  // Sort by reduction
  reports.sort((a, b) => b.reduction - a.reduction);

  // Summary
  const totalOriginal = reports.reduce((s, r) => s + r.originalSize, 0);
  const totalPurged = reports.reduce((s, r) => s + r.purgedSize, 0);
  const totalReduction = totalOriginal > 0 ? ((totalOriginal - totalPurged) / totalOriginal) * 100 : 0;
  const totalRejected = reports.reduce((s, r) => s + r.rejectedSelectors.length, 0);

  // Build report
  const lines: string[] = [
    'PurgeCSS for SCSS — Analysis Report',
    `Generated: ${new Date().toISOString()}`,
    '=' .repeat(60) + '\n',
    `Files analyzed:        ${reports.length}`,
    `Total compiled size:   ${(totalOriginal / 1024).toFixed(1)} KB`,
    `After purge:           ${(totalPurged / 1024).toFixed(1)} KB`,
    `Potential reduction:   ${totalReduction.toFixed(1)}% (${((totalOriginal - totalPurged) / 1024).toFixed(1)} KB)`,
    `Unused selectors:      ${totalRejected}`,
    '',
    '-'.repeat(60),
    '',
  ];

  for (const report of reports) {
    if (report.rejectedSelectors.length === 0 && !report.error) continue;

    const sizeInfo = `${(report.originalSize / 1024).toFixed(1)}KB → ${(report.purgedSize / 1024).toFixed(1)}KB`;
    const reductionStr = report.reduction > 0 ? `-${report.reduction}%` : 'no change';
    lines.push(`📄 ${report.relPath}  (${sizeInfo}, ${reductionStr})`);

    if (report.error) {
      lines.push(`   ❌ ERROR: ${report.error}`);
    }

    for (const sel of report.rejectedSelectors) {
      const displaySelector = normalizeSelector(sel.selector);
      if (sel.sources.length > 0) {
        const loc = sel.sources[0];
        lines.push(`   L${loc.line}  ${displaySelector}  → ${loc.scssFile}:${loc.line}`);
      } else {
        lines.push(`   ???  ${displaySelector}`);
      }
    }
    lines.push('');
  }

  const cleanCount = reports.filter((r) => r.rejectedSelectors.length === 0 && !r.error).length;
  if (cleanCount > 0) {
    lines.push(`(${cleanCount} clean files omitted)`);
    lines.push('');
  }

  lines.push('');
  lines.push('='.repeat(60));
  lines.push('', '', '以上是脚本扫描出来的意疑似无用的 css 选择器，请帮我核对一下，如果确认无用，就删除无用的样式代码');

  writeFileSync(REPORT_FILE, lines.join('\n'), 'utf-8');

  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${(totalOriginal / 1024).toFixed(1)}KB → ${(totalPurged / 1024).toFixed(1)}KB (-${totalReduction.toFixed(1)}%)`);
  console.log(`Unused selectors found: ${totalRejected}`);
  console.log(`\nReport: ${relative(ROOT, REPORT_FILE)}`);
}

await main();
