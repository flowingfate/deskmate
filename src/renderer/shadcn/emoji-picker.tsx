import React, { useCallback, useRef, useState } from 'react'
import {
  EmojiPicker as EmojiPickerPrimitive,
  type Emoji,
  type EmojiPickerListCategoryHeaderProps,
  type EmojiPickerListEmojiProps,
  type EmojiPickerListRowProps,
} from 'frimousse'
import { Flag, Hash, Lightbulb, LoaderCircle, PawPrint, Plane, Search, Smile, Trophy, Users, Utensils } from 'lucide-react'

import { cn } from '@/lib/utilities/utils'
import { Button } from '@/shadcn/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/shadcn/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shadcn/tooltip'

const CATEGORY_NAV_ITEMS = [
  { label: 'Smileys & emotion', Icon: Smile },
  { label: 'People & body', Icon: Users },
  { label: 'Animals & nature', Icon: PawPrint },
  { label: 'Food & drink', Icon: Utensils },
  { label: 'Travel & places', Icon: Plane },
  { label: 'Activities', Icon: Trophy },
  { label: 'Objects', Icon: Lightbulb },
  { label: 'Symbols', Icon: Hash },
  { label: 'Flags', Icon: Flag },
]

interface EmojiPickerProps {
  children: React.ReactElement
  onEmojiSelect: (emoji: string) => void
}

function getCategoryElements(viewport: HTMLElement): HTMLElement[] {
  return Array.from(viewport.querySelectorAll<HTMLElement>('[frimousse-category]'))
    .filter((element) => !element.querySelector('[frimousse-category-header-sizer]'))
}

const EmojiPickerRow: React.FC<EmojiPickerListRowProps> = ({ children, className, ...props }) => (
  <div {...props} className={cn('scroll-my-1 px-1', className)}>
    {children}
  </div>
)

const EmojiPickerEmoji: React.FC<EmojiPickerListEmojiProps> = ({ emoji, className, ...props }) => (
  <button
    {...props}
    type="button"
    aria-label={emoji.label}
    className={cn(
      'flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-sc-accent data-active:bg-sc-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sc-ring focus-visible:ring-offset-2',
      className,
    )}
  >
    {emoji.emoji}
  </button>
)

const EmojiPickerCategoryHeader: React.FC<EmojiPickerListCategoryHeaderProps> = ({ category, className, ...props }) => (
  <div
    {...props}
    className={cn('flex h-9 items-end bg-sc-popover px-3 pb-1.5 text-xs text-sc-muted-foreground', className)}
  >
    {category.label}
  </div>
)

const EmojiPicker: React.FC<EmojiPickerProps> = ({ children, onEmojiSelect }) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) setSearch('')
  }, [])

  const handleEmojiSelect = useCallback((emoji: Emoji) => {
    onEmojiSelect(emoji.emoji)
    setSearch('')
    setOpen(false)
  }, [onEmojiSelect])

  const handleViewportScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const categoryElements = getCategoryElements(event.currentTarget)
    const scrollTop = event.currentTarget.scrollTop
    let nextCategoryIndex = 0

    for (let index = 0; index < categoryElements.length; index += 1) {
      if (categoryElements[index]!.offsetTop > scrollTop + 1) break
      nextCategoryIndex = index
    }

    setActiveCategoryIndex((previous) => previous === nextCategoryIndex ? previous : nextCategoryIndex)
  }, [])

  const handleCategorySelect = useCallback((index: number) => {
    const viewport = viewportRef.current
    if (!viewport) return

    const category = getCategoryElements(viewport)[index]
    if (!category) return

    viewport.scrollTo({ top: category.offsetTop })
    setActiveCategoryIndex(index)
  }, [])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {open && (
        <PopoverContent align="start" aria-label="Choose agent avatar" className="w-[min(22rem,calc(100vw-2rem))] p-0">
          <EmojiPickerPrimitive.Root
            columns={10}
            className="flex h-104 flex-col overflow-hidden"
            onEmojiSelect={handleEmojiSelect}
          >
            <div className="flex items-center gap-2 border-b border-sc-border px-3">
              <Search className="size-4 shrink-0 text-sc-muted-foreground" aria-hidden />
              <EmojiPickerPrimitive.Search
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search emoji"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm text-sc-foreground outline-none placeholder:text-sc-muted-foreground"
                placeholder="Search emoji..."
              />
              <EmojiPickerPrimitive.SkinToneSelector
                aria-label="Change emoji skin tone"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-base transition-colors hover:bg-sc-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-sc-ring focus-visible:ring-offset-2"
                title="Change emoji skin tone"
              />
            </div>
            {search.length === 0 && (
              <TooltipProvider delayDuration={300}>
                <div role="toolbar" aria-label="Emoji categories" className="flex h-11 items-center gap-1 overflow-x-auto border-b border-sc-border px-3">
                  {CATEGORY_NAV_ITEMS.map(({ label, Icon }, index) => {
                    const isActive = index === activeCategoryIndex

                    return (
                      <Tooltip key={label}>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className={cn(
                              'shrink-0 rounded-md text-sc-muted-foreground hover:text-sc-foreground',
                              isActive && 'bg-sc-accent text-sc-accent-foreground hover:bg-sc-accent',
                            )}
                            aria-label={label}
                            aria-pressed={isActive}
                            onClick={() => handleCategorySelect(index)}
                          >
                            <Icon size={16} strokeWidth={1.75} aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{label}</TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              </TooltipProvider>
            )}
            <EmojiPickerPrimitive.Viewport ref={viewportRef} onScroll={handleViewportScroll} className="relative min-h-0 flex-1 outline-none">
              <EmojiPickerPrimitive.Loading className="absolute inset-0 flex items-center justify-center text-sc-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                <span className="sr-only">Loading emojis</span>
              </EmojiPickerPrimitive.Loading>
              <EmojiPickerPrimitive.Empty className="absolute inset-0 flex items-center justify-center text-sm text-sc-muted-foreground">
                No emoji found.
              </EmojiPickerPrimitive.Empty>
              <EmojiPickerPrimitive.List
                className="select-none pb-1"
                components={{
                  Row: EmojiPickerRow,
                  Emoji: EmojiPickerEmoji,
                  CategoryHeader: EmojiPickerCategoryHeader,
                }}
              />
            </EmojiPickerPrimitive.Viewport>
            <div className="flex min-h-10 items-center gap-2 border-t border-sc-border px-3 text-xs text-sc-muted-foreground">
              <EmojiPickerPrimitive.ActiveEmoji>
                {({ emoji }) => emoji ? (
                  <>
                    <span className="text-lg leading-none">{emoji.emoji}</span>
                    <span className="truncate">{emoji.label}</span>
                  </>
                ) : (
                  <span>Select an emoji</span>
                )}
              </EmojiPickerPrimitive.ActiveEmoji>
            </div>
          </EmojiPickerPrimitive.Root>
        </PopoverContent>
      )}
    </Popover>
  )
}

export default EmojiPicker
