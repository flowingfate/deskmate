/**
 * 把 `[@knowledge://...]` / `[@local://...]` / `[@skill://...]` 转成 markdown inline code,
 * 让 LLM 视角下 mention 落地成稳定的字符串字面量(否则前后会被自动加粗 / 当作链接处理)。
 * 三种 scheme 统一走 internal URI 形态,故一条正则覆盖。
 * 历史形态(`[@workspace:...]` / `[@knowledge-base:...]` / `[@chat-session:...]`)不再转换,
 * 在新 renderer 下走纯文本兜底。
 *
 * Domain 重构后 UserMessage.content 是单串,本函数直接处理 string → string。
 */
export function transformMentions(text: string): string {
  return text.replace(/\[@((?:knowledge|local|skill):\/\/[^\]]+)\]/g, '`@$1`');
}
