// 主链路 trace / span id 生成器。
//
// 与 `src/shared/persist/id.ts` 的 `ulid()` 分离 —— 那是持久化 entity id
// 专用（26 字符，含 48-bit 时间戳，跨进程全局唯一）。trace id 是日志体系
// 的内部概念，唯一性范围仅限**单 life_id 内**（life_id 已经隔离单次 app 运行）。
//
// 长度选择依据见 core-log-design.md §2.1 / §2.2：
//   - tid 6 字符 × 32 字母表 = 10.7 亿空间，单 life 内 ~38000 tid 才有 50% 碰撞概率；
//   - sid 4 字符 × 32 = 105 万空间，单 life 内总 span 数（保守 500 turn × 20 ≈ 10000）
//     碰撞概率不到 5%；偶发碰撞复合 (ts, psid) 仍可重建调用树。
//
// 字母表：Crockford Base32（去掉 i/l/o/u，与 ULID 同源），保证字符无歧义。
// 编码：取随机字节、每字节低 5 bit 索引字母表，避免引入 BigInt 计算开销。
//
// 这两个导出是设计文档明确指定的稳定 API（见 core-log-design.md §3.1）：
// renderer 入口、main IPC handler、pi.Session、ToolExecutionScope 各处共用；
// 命名即契约，调用方按"trace id / span id"语义读，不要替换成手写 `randStr(N)`。

import { LogFields } from "./types";

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** 6 字符 Crockford32 —— 一次"用户触发的请求"的 trace id，单 life 内唯一。 */
export function newTraceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[bytes[i] & 31];
  return s;
}

/** 4 字符 Crockford32 —— 一次"有边界的操作"的 span id，容忍偶发碰撞。 */
export function newSpanId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[bytes[i] & 31];
  return s;
}

/**
 * IPC 跨进程传递 tracer 上下文用的最小信封。renderer 拿到 tracer 后
 * `tracer.serialize()` 吐成这个 shape；main 端 `Tracer.deserialize(ctx)` 吃回去。
 */
export interface TraceContext {
  tid: string;
  sid: string;
  psid?: string;
  startAt: number;
}

function purify(data: Record<string, unknown>) {
  let exist = false;
  for (const k in data) {
    if (data[k] === undefined) delete data[k];
    else exist = true;
  }
  return exist;
}

/**
 * 这个只作为灵活的辅助工具，不绑定特殊逻辑
 */
export class Tracer {
  static start() {
    return new Tracer(newTraceId());
  }

  static startWithSpan(sid = newSpanId()) {
    return new Tracer(newTraceId(), sid);
  }

  static deserialize(ctx: TraceContext): Tracer {
    const parent = ctx.psid ? new Tracer(ctx.tid, ctx.psid, undefined, undefined, ctx.startAt) : undefined;
    return new Tracer(ctx.tid, ctx.sid, parent, undefined, ctx.startAt);
  }

  /**
   * Noop 子类：用于"调用方没有主链路 tracer，但仍要写完整业务 log（无 tid/sid/psid/dur）"
   * 的兜底场景。
   *
   * 关键不变式：
   * - `Tracer.noop` 静态实例的 bindings 永远是空对象，**永不被 mutate**（否则单例
   *   会被跨 caller 污染）。所以 `bind / reBind / derive` 全部返回**新的 NOOP 实例**，
   *   不论调用方 immutable 形参传什么。
   * - `fields(extra)` 把 extra + bindings 拼起来，但**省略所有 trace 字段**
   *   （tid/sid/psid/dur 全部不写）—— 让落库的 log 保留 mod/chatSessionId 等
   *   业务字段，只是没法挂到 trace 树上。
   * - `derive()` 也返回新 NOOP 实例（同样继承 bindings）；这样 `(parent ?? Tracer.noop).derive().bind({...})`
   *   的 chain 在 noop 路径下不会破，最终拿到的实例 fields() 时仍带业务字段。
   */
  private static NOOP = class extends Tracer {
    constructor(bindings?: Partial<LogFields>) { super('NOOP', undefined, undefined, bindings); }
    override derive(): Tracer { return new Tracer.NOOP(this.bindings); }
    override enter<T>(fn: (child: Tracer) => T): T { return fn(this.derive()); }
    override bind(fields: Partial<LogFields>, immutable = false): Tracer {
      if (this === Tracer.noop) {
        return new Tracer.NOOP({ ...this.bindings, ...fields });
      }
      return super.bind(fields, immutable);
    }
    override reBind(fields?: Partial<LogFields>): Tracer {
      return new Tracer.NOOP(fields);
    }
    override fields(extra: LogFields): LogFields {
      return { ...extra, ...this.bindings };
    }
  }

  static noop = new Tracer.NOOP();

  private bindings: Partial<LogFields>;
  public readonly startAt: number;

  protected constructor(
    public readonly tid: string,
    public readonly sid?: string,
    public readonly parent?: Tracer,
    bindings?: Partial<LogFields>,
    startAt?: number,
  ) {
    this.bindings = bindings ?? {};
    this.startAt = startAt ?? Date.now();
  }

  private root() {
    let tracer: Tracer = this;
    while (tracer.parent) tracer = tracer.parent;
    return tracer;
  }

  public get dur() {
    return Date.now() - this.startAt;
  }

  public get rootDur() {
    return Date.now() - this.root().startAt;
  }

  /**
   *  注意，derive 会产生新的层级，如果只是想预设一些字段，应该使用 bind。
   *
   *  bindings 总是浅拷贝传给子 tracer —— 避免"子 derive 后不 bind 直接读，
   *  父此时 mutate 自己 bindings"造成的串扰（虽然现有 caller 全是
   *  `derive().bind(...)`，但留出这个安全网比省一次对象 spread 重要）。
   */
  public derive(sid: string = newSpanId()): Tracer {
    const parent = this.sid ? this : undefined;
    return new Tracer(this.tid, sid, parent, this.bindings);
  }

  public enter<T>(fn: (child: Tracer) => T, sid?: string): T {
    return fn(this.derive(sid));
  }

  /**
   *  尤其注意，bind 不会产生新的 sub tracer，这个和 derive 是本质的区别
   */
  public bind(fields: Partial<LogFields>, immutable = false): Tracer {
    const exist = purify(fields);
    if (!exist) return this;
    if (immutable) {
      return new Tracer(this.tid, this.sid, this.parent, { ...this.bindings, ...fields });
    }
    this.bindings = { ...this.bindings, ...fields };
    return this;
  }

  public reBind(fields?: Partial<LogFields>, immutable = false): Tracer {
    this.bindings = {};
    return fields ? this.bind(fields, immutable) : this;
  }

  /**
   *  外部使用时，例如：log.info(tracer.fields({ msg: '...' }, 'self'))
   */
  public fields(extra: LogFields, withDur?: 'self' | 'root'): LogFields {
    const { tid, sid, parent }  = this;
    const psid = parent?.sid;
    // 注意这里是刻意设计的优先级
    const result: LogFields = { ...extra, ...this.bindings, tid, sid };
    if (withDur === 'self') result.dur = this.dur;
    if (withDur === 'root') result.dur = this.rootDur;
    if (parent) result.psid = psid;
    return result;
  }

  public serialize(): TraceContext {
    if (!this.sid) {
      throw new Error('[Tracer.serialize] cannot serialize a tracer without sid; call derive() first.');
    }
    return { tid: this.tid, sid: this.sid, psid: this.parent?.sid, startAt: this.startAt };
  }
}
