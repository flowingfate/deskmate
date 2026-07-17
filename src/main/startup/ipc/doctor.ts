import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/doctor';
import type { Context } from './shared';
import { requireProfileForSender } from './profileContext';

export default function handleDoctorIPC(_ctx: Context) {
  const handle = renderToMain.bindMain(ipcMain);

  handle.submitDoctorInquiry(async (event, payload) => {
    return requireProfileForSender(event).doctor.submitInquiry(payload, event.sender);
  });

  handle.submitAgentAnswer(async (event, payload) => {
    requireProfileForSender(event).doctor.receiveAnswer(payload.taskId, payload.answers, event.sender);
  });
}
