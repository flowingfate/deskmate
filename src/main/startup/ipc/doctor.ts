import { ipcMain } from 'electron';
import { renderToMain } from '@shared/ipc/doctor';
import { requireProfileForSender } from './profileContext';

export default function handleDoctorIPC() {
  const handle = renderToMain.bindMain(ipcMain);

  handle.submitDoctorInquiry(async (event, payload) => {
    return requireProfileForSender(event).doctor.submitInquiry(payload, event.sender);
  });

  handle.submitAgentAnswer(async (event, payload) => {
    requireProfileForSender(event).doctor.receiveAnswer(payload.taskId, payload.answers, event.sender);
  });
}
