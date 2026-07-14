// @vitest-environment jsdom
//
// 回归：附件物化（落盘进 session files/uploads/）必须推迟到「发送」(createMessage)，
// 不能在「添加」(addFile/addOthers) 时发生。
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';

import type { Attachment, UserMessage } from '@shared/persist/types'
import { asFileUri } from '@shared/persist/types'

// copyFileToSandbox = 唯一的落盘入口。整体 mock 以观测调用时机。
const copyMock = vi.fn(async (_file: File, _ctx: unknown) => 'local://uploads/materialized');
vi.mock('@/lib/attachment/copyToSandbox', () => ({
  copyFileToSandbox: (file: File, ctx: unknown) => copyMock(file, ctx),
}));

// processImage = image 草稿的物化入口(main 判别 inline/sandbox)。mock 以观测调用 + 控制返回。
import type { ProcessImageReply } from '@shared/ipc/attachment';
const processImageMock = vi.fn<(input: unknown) => Promise<ProcessImageReply>>();
vi.mock('@/ipc/attachment', () => ({
  attachmentApi: { processImage: (input: unknown) => processImageMock(input) },
}));

import { composeAttachmentsAtom, type AttachmentsStateAtom } from '../Attachments';
import { WithStore } from '@/atom';

interface Manager {
  addFile: (f: File) => Promise<void>;
  addOthers: (f: File) => Promise<void>;
  addImage: (f: File) => Promise<void>;
  getPreviewUrl: (att: Attachment) => string | undefined;
  loadFromMessage: (m: { attachments: Attachment[] }) => void;
  createMessage: (
    text: string,
    ctx: { agentId: string; sessionId: string },
    overrides?: { id?: string; timestamp?: number },
  ) => Promise<UserMessage>;
}

let manager: Manager;
let atomRef: AttachmentsStateAtom;
let currentList: Attachment[] = [];

function Harness() {
  // 每个测试各自渲染一个 <WithStore>,模块级 atom 在该 store 内拿到全新状态,天然隔离。
  const a = composeAttachmentsAtom;
  atomRef = a;
  const [list, actions] = a.use();
  currentList = list;
  manager = actions as unknown as Manager;
  return null;
}

const CTX = { agentId: 'agent-1', sessionId: 'session-1' };

beforeEach(() => {
  copyMock.mockClear();
  processImageMock.mockReset();
  // jsdom 不实现 objectURL,草稿 image 预览 + revoke 需要桩。
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-preview');
  globalThis.URL.revokeObjectURL = vi.fn();
  // jsdom 的 File 不实现 arrayBuffer;processImage 已 mock,字节内容无关紧要,返回空桩即可。
  if (typeof File.prototype.arrayBuffer !== 'function') {
    File.prototype.arrayBuffer = function () {
      return Promise.resolve(new ArrayBuffer(0));
    };
  }
});

describe('attachment materialization is deferred to send', () => {
  it('addFile stages a draft (empty URI) without touching sandbox; createMessage materializes', async () => {
    render(
      <WithStore>
        <Harness />
      </WithStore>,
    );

    const file = new File(['hello world'], 'note.txt', { type: 'text/plain' });
    await act(async () => {
      await manager.addFile(file);
    });

    // 添加阶段：绝不落盘，草稿 URI 为空。
    expect(copyMock).not.toHaveBeenCalled();
    expect(currentList).toHaveLength(1);
    expect(currentList[0].kind).toBe('text');
    expect((currentList[0] as Extract<Attachment, { kind: 'text' }>).fileUri).toBe('');

    // 发送阶段：才物化，URI 被替换为真 sandbox URI。
    let msg: UserMessage;
    await act(async () => {
      msg = await manager.createMessage('go', CTX);
    });
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock).toHaveBeenCalledWith(file, CTX);
    const att = msg!.attachments[0] as Extract<Attachment, { kind: 'text' }>;
    expect(att.kind).toBe('text');
    expect(att.fileUri).toBe('local://uploads/materialized');
  });

  it('addOthers (opaque) defers identically', async () => {
    render(
      <WithStore>
        <Harness />
      </WithStore>,
    );

    const file = new File([new Uint8Array([1, 2, 3])], 'blob.bin', {
      type: 'application/octet-stream',
    });
    await act(async () => {
      await manager.addOthers(file);
    });
    expect(copyMock).not.toHaveBeenCalled();
    expect(currentList[0].kind).toBe('opaque');

    let msg: UserMessage;
    await act(async () => {
      msg = await manager.createMessage('', CTX);
    });
    expect(copyMock).toHaveBeenCalledTimes(1);
    const att = msg!.attachments[0] as Extract<Attachment, { kind: 'opaque' }>;
    expect(att.fileUri).toBe('local://uploads/materialized');
  });

  it('attachments loaded from an existing message (real URI) pass through untouched', async () => {
    render(
      <WithStore>
        <Harness />
      </WithStore>,
    );

    const existing: Attachment = {
      kind: 'text',
      fileName: 'old.txt',
      fileSize: 4,
      mimeType: 'text/plain',
      fileUri: asFileUri('local://uploads/old.txt'),
    };
    act(() => {
      manager.loadFromMessage({ attachments: [existing] });
    });

    let msg: UserMessage;
    await act(async () => {
      msg = await manager.createMessage('edit', CTX);
    });
    // 已有真 URI 的附件不进 pendingFiles —— 发送时不应再次落盘。
    expect(copyMock).not.toHaveBeenCalled();
    expect((msg!.attachments[0] as Extract<Attachment, { kind: 'text' }>).fileUri).toBe(
      'local://uploads/old.txt',
    );
  });

  it('addImage stages a draft (empty dataUrl + objectURL preview) without calling processImage', async () => {
    render(
      <WithStore>
        <Harness />
      </WithStore>,
    );

    const file = new File([new Uint8Array([1, 2, 3])], 'pic.png', { type: 'image/png' });
    await act(async () => {
      await manager.addImage(file);
    });

    // 添加阶段:绝不触发判别/物化,dataUrl 占位为空,预览走 objectURL。
    expect(processImageMock).not.toHaveBeenCalled();
    expect(currentList).toHaveLength(1);
    const draft = currentList[0] as Extract<Attachment, { kind: 'image' }>;
    expect(draft.kind).toBe('image');
    expect(draft.source).toEqual({ kind: 'dataUrl', data: '' });
    expect(manager.getPreviewUrl(draft)).toBe('blob:mock-preview');
  });

  it('createMessage materializes a small image inline via processImage (dataUrl)', async () => {
    processImageMock.mockResolvedValue({
      success: true,
      data: { kind: 'inline', mimeType: 'image/png', base64: 'QUJD', width: 12, height: 8 },
    });
    render(
      <WithStore>
        <Harness />
      </WithStore>,
    );

    const file = new File([new Uint8Array([1, 2, 3])], 'small.png', { type: 'image/png' });
    await act(async () => {
      await manager.addImage(file);
    });

    let msg: UserMessage;
    await act(async () => {
      msg = await manager.createMessage('go', CTX);
    });
    expect(processImageMock).toHaveBeenCalledTimes(1);
    expect(copyMock).not.toHaveBeenCalled();
    const att = msg!.attachments[0] as Extract<Attachment, { kind: 'image' }>;
    expect(att.kind).toBe('image');
    expect(att.source).toEqual({ kind: 'dataUrl', data: 'QUJD' });
    expect(att.mimeType).toBe('image/png');
    expect(att.width).toBe(12);
    expect(att.height).toBe(8);
  });

  it('createMessage materializes a large image to sandbox via processImage (image+fileRef)', async () => {
    processImageMock.mockResolvedValue({
      success: true,
      data: {
        kind: 'sandbox',
        uri: 'local://uploads/big.png',
        fileName: 'big.png',
        size: 999,
        mimeType: 'image/png',
        width: 2000,
        height: 1500,
      },
    });
    render(
      <WithStore>
        <Harness />
      </WithStore>,
    );

    const file = new File([new Uint8Array([4, 5, 6])], 'big.png', { type: 'image/png' });
    await act(async () => {
      await manager.addImage(file);
    });

    let msg: UserMessage;
    await act(async () => {
      msg = await manager.createMessage('', CTX);
    });
    expect(processImageMock).toHaveBeenCalledTimes(1);
    // 大图走 sandbox,但**保持 image 语义**:source = fileRef 指向落盘文件,非 opaque。
    const att = msg!.attachments[0] as Extract<Attachment, { kind: 'image' }>;
    expect(att.kind).toBe('image');
    expect(att.source).toEqual({ kind: 'fileRef', uri: 'local://uploads/big.png' });
    expect(att.width).toBe(2000);
    expect(att.height).toBe(1500);
  });
});
