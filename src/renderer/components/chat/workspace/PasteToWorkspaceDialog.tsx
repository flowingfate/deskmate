import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Clipboard, Loader2, FileText, Sparkles } from 'lucide-react';
import { log } from '@/log';
import { llmApi } from '@/ipc/llm';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/shadcn/dialog';
import { Button } from '@/shadcn/button';

const logger = log.child({ mod: 'PasteToWorkspaceDialog' });

export interface PasteToWorkspaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (content: string, fileName: string) => Promise<{ status: 'saved' | 'skipped' | 'canceled' }>;
  workspacePath: string;
}

/**
 * PasteToWorkspaceDialog - Dialog for pasting text into the Workspace
 *
 * Features:
 * 1. Provides a text input area for users to paste content
 * 2. Automatically calls LLM to generate a file name and extension
 * 3. Allows users to edit the file name
 * 4. Saves the file to the current workspace directory
 */
const PasteToWorkspaceDialog: React.FC<PasteToWorkspaceDialogProps> = ({
  isOpen,
  onClose,
  onSave,
  workspacePath
}) => {
  // State
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generateTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Reset state
  const resetState = useCallback(() => {
    setContent('');
    setFileName('');
    setIsGeneratingName(false);
    setIsSaving(false);
    setError(null);
    if (generateTimeoutRef.current) {
      clearTimeout(generateTimeoutRef.current);
      generateTimeoutRef.current = null;
    }
  }, []);

  // Close dialog
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  // Generate file name (with debounce)
  const generateFileName = useCallback(async (contentToAnalyze: string) => {
    if (!contentToAnalyze.trim() || contentToAnalyze.trim().length < 10) {
      return;
    }

    setIsGeneratingName(true);
    setError(null);

    try {
      const result = await llmApi.generateFileName(contentToAnalyze);

      if (result.success && result.data.fullFileName) {
        setFileName(result.data.fullFileName);
      } else {
        // Fallback: generate timestamp-based file name
        const timestamp = Date.now();
        setFileName(`pasted-content-${timestamp}.txt`);
      }
    } catch (err) {
      logger.error({ msg: "Error generating file name:", err: err });
      // Fallback
      const timestamp = Date.now();
      setFileName(`pasted-content-${timestamp}.txt`);
    } finally {
      setIsGeneratingName(false);
    }
  }, []);

  // Trigger file name generation when content changes (with debounce)
  const handleContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setError(null);

    // Clear previous timer
    if (generateTimeoutRef.current) {
      clearTimeout(generateTimeoutRef.current);
    }

    // Only trigger generation when content is long enough
    if (newContent.trim().length >= 10) {
      generateTimeoutRef.current = setTimeout(() => {
        generateFileName(newContent);
      }, 800); // 800ms debounce
    }
  }, [generateFileName]);

  // Manually trigger file name regeneration
  const handleRegenerateFileName = useCallback(() => {
    if (content.trim().length >= 10) {
      generateFileName(content);
    }
  }, [content, generateFileName]);

  // Handle file name input
  const handleFileNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    // Sanitize file name: remove illegal characters
    const cleanedName = newName.replace(/[<>:"/\\|?*]/g, '');
    setFileName(cleanedName);
  }, []);

  // Save file
  const handleSave = useCallback(async () => {
    if (!content.trim()) {
      setError('Please enter some content to save.');
      return;
    }

    if (!fileName.trim()) {
      setError('Please enter a file name.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const result = await onSave(content, fileName);
      if (result.status !== 'canceled') {
        handleClose();
      }
    } catch (err) {
      logger.error({ msg: "Error saving file:", err: err });
      setError(err instanceof Error ? err.message : 'Failed to save file.');
    } finally {
      setIsSaving(false);
    }
  }, [content, fileName, onSave, handleClose]);

  // Handle Ctrl+Enter shortcut to save
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!isSaving && content.trim() && fileName.trim()) {
        handleSave();
      }
    }
  }, [handleSave, isSaving, content, fileName]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        initialFocusRef={textareaRef}
        className="max-w-[560px] max-h-[80vh] flex flex-col p-0"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <DialogHeader className="px-5 py-4 border-b border-sc-border">
          <DialogTitle className="flex items-center gap-2.5 text-base">
            <Clipboard size={20} className="text-sc-muted-foreground" />
            <span>Paste to Knowledge Base</span>
          </DialogTitle>
        </DialogHeader>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {/* Text Input */}
          <div className="flex flex-col">
            <label className="flex items-center gap-1.5 text-[13px] font-semibold text-sc-foreground mb-2">Content</label>
            <textarea
              ref={textareaRef}
              className="w-full min-h-[200px] max-h-[300px] rounded-[10px] border border-sc-border bg-sc-muted/30 px-4 py-3.5 font-mono text-sm text-sc-foreground resize-y transition-colors focus:outline-none focus:ring-2 focus:ring-sc-ring disabled:bg-sc-muted disabled:cursor-not-allowed"
              value={content}
              onChange={handleContentChange}
              placeholder="Paste content here..."
              disabled={isSaving}
            />
          </div>

          {/* File Name Input */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-[13px] font-semibold text-sc-foreground">
                <FileText size={14} />
                <span>File Name</span>
              </label>
              {content.trim().length >= 10 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-neutral-500 bg-neutral-500/10 border border-neutral-500/20 rounded-md transition-colors hover:bg-neutral-500/15 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleRegenerateFileName}
                  disabled={isGeneratingName || isSaving}
                  title="Regenerate file name with AI"
                >
                  <Sparkles size={14} />
                  <span>Regenerate</span>
                </Button>
              )}
            </div>
            <div className="relative flex items-center">
              <input
                type="text"
                className="w-full rounded-[10px] border border-sc-border bg-sc-muted/30 px-4 py-3 pr-10 text-sm text-sc-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-sc-ring disabled:bg-sc-muted disabled:cursor-not-allowed"
                value={fileName}
                onChange={handleFileNameChange}
                placeholder={isGeneratingName ? 'Generating...' : 'Enter file name...'}
                disabled={isSaving}
              />
              {isGeneratingName && (
                <div className="absolute right-3 flex items-center justify-center text-neutral-500">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              )}
            </div>
            <p className="mt-1.5 text-xs text-sc-muted-foreground">
              AI auto-generates file name based on content format (text, markdown, json, html, js, etc.)
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-600">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-5 py-4 border-t border-sc-border bg-sc-muted/30 flex-row justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !content.trim() || !fileName.trim()}
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PasteToWorkspaceDialog;
