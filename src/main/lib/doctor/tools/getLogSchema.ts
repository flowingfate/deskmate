/**
 * get_log_schema — 输出 sqlite 表结构 + 字段语义。
 * 用于 doctor agent 第一次使用 read_app_logs / trace_timeline 前的字段对齐。
 */

import type { Tool } from '@earendil-works/pi-ai';
import { jsonSchema } from '@main/pi/tools/schema';
import { LOG_SCHEMA_DOC } from '@shared/log/query';

export const getLogSchemaToolDef: Tool = {
  name: 'get_log_schema',
  description:
    'Return the sqlite log table layout and field semantics. Call this once before iterating with read_app_logs / trace_timeline so the field names and level mapping are unambiguous.',
  parameters: jsonSchema({
    type: 'object',
    properties: {},
    required: [],
  }),
};

export async function executeGetLogSchema(): Promise<string> {
  return LOG_SCHEMA_DOC;
}
