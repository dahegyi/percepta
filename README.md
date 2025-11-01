# Percepta

**Percepta** is an intelligent Chrome extension that provides AI-powered webpage analysis and interactive conversations about web content.

## Features

### Smart Page Analysis

- Capture and analyze any webpage with a single click
- AI-powered descriptions that understand page content and context
- Automatic screenshot integration for visual reference
- Intelligent content chunking for optimal processing

### Interactive Conversations

- Ask follow-up questions about analyzed pages
- Context-aware responses that remember your conversation
- Suggested action buttons for natural conversation flow
- Multi-tab support with independent conversations per tab

### Wikipedia Integration

- Automatic entity recognition and linking
- Hover previews for Wikipedia articles
- Seamless access to additional context without leaving the page

### Customizable Experience

- **Themes**: Light, Dark, High Contrast, or Auto (system preference)
- **Languages**: English, Spanish (Español), Japanese (日本語)
- **Font Sizes**: 5 size options for comfortable reading
- **Detail Levels**: Choose between brief, normal, or detailed responses

### Accessibility First

- Full keyboard navigation support
- Screen reader optimized with live regions
- ARIA labels and semantic HTML throughout
- Configurable text-to-speech announcements
- High contrast theme for visual accessibility

### Conversation Management

- Automatic conversation saving and archiving
- Browse and restore previous conversations
- Per-tab conversation history
- Clear visual indicators for active sessions

## Architecture

### Core Components

**Background Service Worker** (`background.js`)

- Manages extension lifecycle and message routing
- Handles screenshot capture and context menus
- Coordinates between tabs and the side panel

**Side Panel** (`sidepanel/`)

- Main conversation interface
- Real-time streaming responses
- Wikipedia preview tooltips
- Tab-aware conversation switching

**Popup** (`popup.html`, `popup.js`)

- Quick access to page analysis
- Conversation history browser
- Settings management
- Recent activity overview

**AI Engine** (`ai/`)

- `sessionManager.js` - Manages AI sessions and streaming
- `contextChunker.js` - Intelligent content splitting
- `modelFactory.js` - AI model initialization
- `imageUtils.js` - Screenshot processing

**Storage** (`background/conversationStorage.js`)

- Persistent conversation history
- Metadata tracking (timestamps, URLs, titles)
- Efficient retrieval and filtering

### Internationalization

Fully localized in three languages:

- English (`_locales/en/`)
- Spanish (`_locales/es/`)
- Japanese (`_locales/ja/`)

### Utilities

**Wikipedia Integration** (`utils/`)

- `wikiLinker.js` - Entity detection and linking
- `wikiPreview.js` - Hover preview tooltips
- `wikiUtils.js` - Wikipedia API interactions

**Accessibility** (`utils/streamAccessibility.js`)

- Screen reader announcements
- Live region management
- Streaming content accessibility

## Setup Wizard

First-time users are guided through an interactive setup:

1. **Welcome** - Introduction to Percepta
2. **Theme** - Choose your visual preference
3. **Detail Level** - Set response verbosity
4. **Accessibility** - Configure assistive features
5. **Shortcuts** - Learn keyboard navigation
6. **Completion** - Start using Percepta

## Technology Stack

- **Chrome Extension Manifest V3**
- **Chrome Built-in AI API** (Prompt API)
- **Offscreen Documents** for AI processing
- **Side Panel API** for persistent UI
- **Chrome Storage API** for data persistence
- **Text-to-Speech API** for accessibility

## Key Features in Detail

### Multi-Tab Conversation Management

Each browser tab maintains its own independent conversation. Switch between tabs seamlessly, and Percepta automatically restores the correct conversation context.

### Intelligent Content Processing

Pages are analyzed using smart chunking that preserves context while staying within the model limits. Screenshots are automatically captured and included for visual understanding.

### Streaming Responses

AI responses stream in real-time, providing immediate feedback. The interface remains responsive during generation, with proper loading indicators.

### Persistent History

All conversations are automatically saved with metadata (timestamp, page URL, title). Browse your history, restore previous conversations, or clear old sessions.

### Action Buttons

The AI can suggest relevant follow-up questions as clickable buttons, making conversations more natural and discoverable.

## Browser Requirements

- Chrome 138+ (for Built-in AI API support)
- Prompt API for Gemini Nano enabled in `chrome://flags`
- Prompt API for Gemini Nano with Multimodal Input enabled in `chrome://flags`

> Read more about the requirements in the [Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api)

## Privacy

All AI processing happens locally using Chrome's built-in AI. Conversations are stored locally in Chrome's storage.

The data points that are sent to Chrome's sync storage are:

- Detail Level
- Language
- Theme
- Font Size

---

**Version**: 1.0  
**License**: MIT
**Manifest Version**: 3
