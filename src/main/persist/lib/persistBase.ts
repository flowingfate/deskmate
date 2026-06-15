/**
 * PersistBase —— 给所有"读改写整文件"型 store 用的统一持久化基类。
 *
 * 解决两个问题：
 *  1) 同一对象的多次连环 `persist()` 调用会被自动合并成一次写盘（节流）；
 *  2) 写盘期间发生的新 mutate 不会被丢失 —— 当前写完后自动再写一轮（trailing re-queue）。
 *
 * 语义保证：
 *  - `await persist()` 返回时，调用方自己在 await 之前做的全部 mutate 已经落盘。
 *  - 不保证"之后他人的 mutate 没被夹带进同一次写"——这是节流模型的固有特性，通常无所谓。
 *  - 一次 doPersist 内部不允许再 mutate 自身——会破坏"快照即写入"假设；如果需要，请在外部 mutate 完后再调 persist。
 *
 * **不适合**用本基类的场景：
 *  - append-only 流（messages.jsonl）—— 每条都必须落盘且只落一次，与"合并写"模型不兼容。
 *  - 显式语义事务（如 Profiles.profilesIndex 的原子切换）—— 不能被延迟到下一 tick。
 *  - bootstrap 期一次性写入 —— 没有合并需求，徒增复杂度。
 */
export abstract class PersistBase {
  /** 当前飞行中的写 promise；为空表示空闲。 */
  private writing?: Promise<void>;

  /** 自从上次 doPersist 开始执行后，是否又有 mutate 进来。 */
  private dirty = false;

  /**
   * 标记需要持久化。无论何时调用，返回的 promise resolve 后，调用方自己之前的 mutate 已落盘。
   *
   * 行为：
   *  - 空闲态 → 立即开写（不延迟一个 tick，避免无谓延迟）
   *  - 飞行中 → 标 dirty，共享当前 promise；当前写完后基类自动再写一轮捎上新数据
   *  - 多个 awaiter 共享同一 promise；错误也共享
   */
  public persist(): Promise<void> {
    this.dirty = true;
    if (this.writing) return this.writing;
    this.writing = this.runLoop().finally(() => {
      this.writing = undefined;
    });
    return this.writing;
  }

  /**
   * 当前是否有飞行中的写。供测试 / 调试用，业务代码不要依赖。
   */
  public get isPersisting(): boolean {
    return this.writing !== undefined;
  }

  private async runLoop(): Promise<void> {
    // 让出一个 microtask，把"同步 tick 内的连环 mutate + persist 调用"全部收拢到
    // 第一次 doPersist 的快照里 —— 真正达成"一次同步 burst 只写一次盘"。
    //
    // 不加这行也能跑：trailing re-queue 会保证后续 mutate 在下一轮写入。
    // 但那样同步 burst 会触发 2 次 doPersist（首轮快照只包含第一次 mutate，
    // trailing 轮才捎上其余）。加上之后是 1 次 IO，纯赚。
    await Promise.resolve();

    // 循环直到没有新的 dirty 为止。
    // 每轮开始前先清 dirty —— 这样 doPersist 执行期间到来的 mutate 会让 dirty 重新为 true，
    // 进入下一轮；不会漏掉。
    while (this.dirty) {
      this.dirty = false;
      await this.doPersist();
    }
  }

  /**
   * 子类实现真正的写盘动作。每轮调用时应在内部"拍快照"（toJSON 等），不要持有跨轮状态。
   * 抛出的错误会作为 `persist()` 的拒因；后续 mutate 调用方会拿到新 promise 重试。
   */
  protected abstract doPersist(): Promise<void>;
}
