/**
 * Vendored from `args-tokenizer` 0.3.0.
 *
 * - Source:   https://github.com/TrySound/args-tokenizer/blob/0.3.0/src/args-tokenizer.ts
 * - Author:   Bogdan Chadkin <opensource@trysound.io>
 * - License:  MIT (see `./argsTokenizer.LICENSE`)
 *
 * ---------------------------------------------------------------------------
 * Why vendored, not npm-installed
 * ---------------------------------------------------------------------------
 *   1. Upstream is feature-complete and inactive (last release 2024-12,
 *      last commit 2025-02). Future security or behavior patches won't come
 *      via `npm update`. The biggest selling point of a dep — "free upstream
 *      patches" — does not apply here.
 *   2. Single file, ~50 LOC of pure logic, zero deps. npm gives us no value
 *      over a copy.
 *   3. We deliberately tighten one POSIX edge case (see "Modifications"
 *      below). Owning the file lets us do that without forking + publishing
 *      a private package.
 *   4. Removes one supply-chain surface for a low-stars (~30) package.
 *
 * ---------------------------------------------------------------------------
 * Modifications from upstream 0.3.0
 * ---------------------------------------------------------------------------
 *
 *   [M1] Single-quote literal-backslash (POSIX strict)
 *
 *     Upstream consumes `\` as an escape introducer regardless of quote
 *     context, so `'a\b'` produces `ab` (backslash dropped). POSIX shells
 *     treat single quotes as fully literal — including backslash — so the
 *     correct tokenization is `a\b`.
 *
 *     This matters for us because the consumer is an LLM that has been
 *     trained on POSIX semantics. If the tokenizer silently eats the
 *     backslash, the LLM's subsequent reasoning ("the value I just passed
 *     contains a `\`") drifts from reality.
 *
 *     Fix: gate the `\\` escape branch on `openningQuote !== "'"`. Inside
 *     a single-quoted run, `\` falls through to the literal-append branch.
 *
 *     Marked inline with `// [M1]` so a future upstream diff is easy.
 *
 * All other behavior is byte-for-byte upstream. Tests in
 * `../__tests__/parseCmdline.test.ts` lock the contract.
 */

const spaceRegex = /\s/;

type Options = {
  loose?: boolean;
};

/**
 * Tokenize a shell string into argv array.
 *
 * See module header for vendor provenance and modifications.
 */
export const tokenizeArgs = (
  argsString: string,
  options?: Options,
): string[] => {
  const tokens: string[] = [];
  let currentToken = '';
  let openningQuote: undefined | string;
  let escaped = false;
  for (let index = 0; index < argsString.length; index += 1) {
    const char = argsString[index];

    if (escaped) {
      escaped = false;
      // escape newline inside of quotes
      // ignore newline elsewhere
      if (openningQuote || char !== '\n') {
        currentToken += char;
      }
      continue;
    }

    // [M1] Skip the escape branch entirely inside single quotes — POSIX
    // single-quote rule: every character (including `\`) is literal.
    if (char === '\\' && openningQuote !== "'") {
      escaped = true;
      continue;
    }

    if (openningQuote === undefined && spaceRegex.test(char)) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        currentToken = '';
      }
      continue;
    }

    if (char === "'" || char === '"') {
      if (openningQuote === undefined) {
        openningQuote = char;
        continue;
      }
      if (openningQuote === char) {
        openningQuote = undefined;
        continue;
      }
    }

    currentToken += char;
  }
  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }
  if (options?.loose) {
    return tokens;
  }
  if (openningQuote) {
    throw Error('Unexpected end of string. Closing quote is missing.');
  }
  return tokens;
};
