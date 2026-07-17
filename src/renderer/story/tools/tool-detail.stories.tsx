import { lazy, Suspense } from 'react';
import type { Story } from '@ladle/react';
import { installToolStoryElectronMock } from './mockElectron';

installToolStoryElectronMock();

const RendererGallery = lazy(() => import('./RendererGallery'));

export default { title: 'Chat / Tools / Tool Detail View' };

export const RendererSlots: Story = () => (
  <Suspense fallback={<span className="text-sm text-sc-muted-foreground">Loading tool renderers…</span>}>
    <RendererGallery />
  </Suspense>
);
