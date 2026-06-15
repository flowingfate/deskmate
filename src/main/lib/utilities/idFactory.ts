import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { buildChatSessionId, buildEvalSessionId, buildScheduleJobId } from '../../../shared/utils/idFormats';
import { getInstallationDeviceIdPath } from '@main/persist/lib/path';


let cachedDeviceId: string | null = null;
export function getOrCreateInstallationDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  const idFilePath = getInstallationDeviceIdPath();
  try {
    const existingId = fs.existsSync(idFilePath)
      ? fs.readFileSync(idFilePath, 'utf8').trim()
      : '';

    if (existingId) {
      return cachedDeviceId = existingId;
    }

    const nextId = randomUUID();
    fs.mkdirSync(path.dirname(idFilePath), { recursive: true });
    fs.writeFileSync(idFilePath, nextId, 'utf8');
    return cachedDeviceId = nextId;
  } catch {
    return randomUUID();
  }
}

export function generateChatSessionId(): string {
  return buildChatSessionId(getOrCreateInstallationDeviceId());
}

export function generateScheduleJobId(date: Date = new Date()): string {
  return buildScheduleJobId(getOrCreateInstallationDeviceId(), date);
}

export function generateEvalSessionId(): string {
  return buildEvalSessionId(getOrCreateInstallationDeviceId());
}