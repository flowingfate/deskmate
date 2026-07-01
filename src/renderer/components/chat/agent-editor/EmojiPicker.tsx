import React, { useState, useCallback, useEffect } from 'react'

import { Button } from '@/shadcn/button'
import { EmojiPickerProps } from './types'
import { X } from 'lucide-react'

// Emoji category data
const EMOJI_CATEGORIES: Record<string, string[]> = {
  "Costumed Faces": ["🤡","👻","👽","🤖","🎃","😈","👹","💩"],
  "Cat Faces": ["😺","😸","😹","😻","😼","😽","🙀","😿","😾"],
  "Monkey Faces": ["🐵","🐒","🙈","🙉","🙊"],
  "Hearts": ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝"],
  "Smileys & Emotions": [
    "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇",
    "🙂","🙃","😉","😌","😍","🥰","😘","😗","😙","😚",
    "😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎",
    "🥳","😏","😒","😞","😔","😟","😕","🙁","☹️",
    "😣","😖","😫","😩","🥺","😢","😭","😤","😠","😡"
  ],
  "Professions & Roles": [
    "👮","👷","💂","🕵️","👩‍⚕️","👨‍⚕️","👩‍🌾","👨‍🌾",
    "👩‍🍳","👨‍🍳","👩‍🎓","👨‍🎓","👩‍🏫","👨‍🏫",
    "👩‍⚖️","👨‍⚖️","👩‍💻","👨‍💻","👩‍🎤","👨‍🎤",
    "👩‍🚀","👨‍🚀","👩‍🚒","👨‍🚒"
  ],
  "Fantasy Characters": [
    "👼","🤶","🎅","🧙","🧝","🧛","🧟","🧞","🧜","🧚"
  ],
  "Animals & Nature": [
    "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯",
    "🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🐤",
    "🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄",
    "🐝","🦋","🐌","🐞","🐜","🦟","🌸","🌼","🌻","🌲","🌳"
  ],
  "Food & Drink": [
    "🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍒",
    "🥝","🍅","🥑","🍆","🥔","🥕","🌽","🌶️","🥒",
    "🍞","🥐","🥖","🧀","🥚","🍳","🥞","🥓",
    "🍔","🍟","🍕","🌭","🥪","🌮","🌯",
    "🍣","🍱","🍛","🍜","🍝","🍰","🧁","🍩","🍪","☕","🍵"
  ],
  "Travel & Places": [
    "🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒",
    "🚲","🛴","🛵","✈️","🛫","🛬","🚀","🚁",
    "🚢","⛴️","🗽","🗼","🏰","🏯","🏟️","🏖️","⛰️","🌋","🏕️"
  ],
  "Activities": [
    "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🎱",
    "🏓","🏸","🥅","🏒","🏑","🥍","🏏",
    "🎿","⛷️","🏂","🏋️","🤼","🤸","⛹️","🤺","🤾","🏊","🚴","🏇"
  ],
  "Objects": [
    "⌚","📱","💻","🖥️","🖨️","⌨️","🖱️","🖲️",
    "📷","📸","🎥","📺","📻","🎙️","🎚️","🎛️",
    "💡","🔦","🕯️","🪔","🔌","🔋",
    "📕","📗","📘","📙","📚","📓","📒","📔",
    "✏️","🖊️","🖋️","✂️","📎","🗂️","📦","🔒","🔑"
  ]
}

const CATEGORY_NAMES = Object.keys(EMOJI_CATEGORIES)

// Find the category that a given emoji belongs to
const findEmojiCategory = (emoji: string): string => {
  for (const [category, emojis] of Object.entries(EMOJI_CATEGORIES)) {
    if (emojis.includes(emoji)) {
      return category
    }
  }
  return CATEGORY_NAMES[0] // Default to first category
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({
  isOpen,
  onClose,
  onEmojiSelect,
  currentEmoji
}) => {
  const [selectedEmoji, setSelectedEmoji] = useState(currentEmoji || '🤖')
  const [activeCategory, setActiveCategory] = useState(CATEGORY_NAMES[0])

  // Sync selectedEmoji and activeCategory state when currentEmoji prop changes
  useEffect(() => {
    const emoji = currentEmoji || '🤖'
    setSelectedEmoji(emoji)
    setActiveCategory(findEmojiCategory(emoji))
  }, [currentEmoji])

  const handleEmojiClick = useCallback((emoji: string) => {
    setSelectedEmoji(emoji)
  }, [])

  const handleConfirm = useCallback(() => {
    onEmojiSelect(selectedEmoji)
    onClose()
  }, [selectedEmoji, onEmojiSelect, onClose])

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }, [onClose])

  if (!isOpen) return null

  return (
    <div data-dbg="EmojiPicker" className="fixed inset-0 flex items-center justify-center p-8 z-1100 bg-black/30 animate-[fadeIn_0.2s_ease-out]" onClick={handleOverlayClick}>
      <div className="w-[min(400px,90vw)] bg-white rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.3)] animate-[slideIn_0.3s_ease-out]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-border bg-slate-50">
          <h3 className="m-0 text-lg font-semibold text-content-strong">Choose Agent Avatar</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>

        {/* Selected Display */}
        <div className="px-6 py-3 text-center bg-slate-50 border-b border-border">
          <div className="text-5xl mb-2 leading-none">{selectedEmoji}</div>
          <span className="text-content-secondary text-sm font-medium">Selected</span>
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-1.5 px-4 py-3 border-b border-border bg-surface-subtle">
          {CATEGORY_NAMES.map((category) => (
            <Button
              key={category}
              variant="ghost"
              size="icon"
              className={`flex items-center justify-center w-auto h-auto px-3 py-1.5 rounded-2xl border border-border bg-surface-secondary text-content-secondary text-xs font-medium cursor-pointer transition-all whitespace-nowrap hover:bg-neutral-500/10 hover:border-neutral-500/30 hover:text-neutral-500 ${activeCategory === category ? 'bg-neutral-500 border-neutral-500 text-white' : ''}`}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </Button>
          ))}
        </div>

        {/* Emoji Grid */}
        <div className="grid grid-cols-8 gap-1.5 px-5 py-4 overflow-y-auto overflow-x-hidden custom-scrollbar">
          {(EMOJI_CATEGORIES[activeCategory] || []).map((emoji, index) => (
            <Button
              key={`${emoji}-${index}`}
              variant="ghost"
              size="icon"
              className={`flex items-center justify-center size-10 min-w-10 min-h-10 rounded-lg border-2 border-transparent bg-transparent text-xl cursor-pointer transition-all shrink-0 hover:bg-neutral-500/10 hover:border-neutral-500/30 hover:scale-110 ${selectedEmoji === emoji ? 'bg-neutral-500/20 border-neutral-500 scale-110' : ''}`}
              onClick={() => handleEmojiClick(emoji)}
            >
              {emoji}
            </Button>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-2 border-t border-border bg-slate-50">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  )
}

export default EmojiPicker