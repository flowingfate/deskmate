# Feature Flags Management System

## Overview

Feature Flags are developer tools used to control feature availability. Flag states are defined by developers in the backend, or passed via command-line arguments.

## Naming Convention

All feature flags use the unified `deskmateFeatureXXXXX` naming format:

```typescript
'deskmateFeatureDevTools'
'deskmateFeatureDebugLogging'
'deskmateFeatureExperimentalChat'
```

## Defining Feature Flag Default Values

### 1. Static Boolean

```typescript
{
  name: 'deskmateFeatureDevTools',
  description: 'Developer tools panel',
  defaultValue: false,  // static value
},
```

### 2. Dynamic Logic Function

Dynamically computed based on context (dev environment, brand, platform):

```typescript
{
  name: 'deskmateFeatureDebugLogging',
  description: 'Debug logging',
  // Enable only in development environment
  defaultValue: (ctx) => ctx.isDev,
},

{
  name: 'deskmateFeatureExperimentalChat',
  description: 'Experimental chat feature',
  // Enable only in dev environment
  defaultValue: (ctx) => ctx.isDev,
},
```

### Context (FeatureFlagContext) Fields:

| Property | Type | Description |
|----------|------|-------------|
| `isDev` | boolean | Whether running in a development environment |
| `brandName` | string | Current brand (deskmate) |
| `platform` | NodeJS.Platform | Platform (darwin, win32, linux) |

## Command-Line Overrides

Command-line arguments take precedence over default values:

```bash
# Windows
app.exe --enable-features=deskmateFeatureDevTools,deskmateFeatureDebugLogging

# macOS
./DESKMATE.app/Contents/MacOS/DESKMATE --enable-features=deskmateFeatureDevTools

# Development environment
npm run dev -- --enable-features=deskmateFeatureDevTools,deskmateFeatureMcpDebug
```

## Using Flags in Code

### Main Process

```typescript
import { isFeatureEnabled } from './lib/featureFlags';

if (isFeatureEnabled('deskmateFeatureDevTools')) {
  // Enable developer tools functionality
}
```

### Renderer Process (React)

```tsx
import { useFeatureFlag } from '../lib/featureFlags';

function MyComponent() {
  const isDevToolsEnabled = useFeatureFlag('deskmateFeatureDevTools');

  if (!isDevToolsEnabled) return null;

  return <DevToolsPanel />;
}
```

## Adding a New Flag

### 1. Add the type in `types.ts`

```typescript
export type FeatureFlagName =
  | 'deskmateFeatureDevTools'
  | 'deskmateFeatureMyNewFeature'  // add new name
  ;
```

### 2. Add the definition in `featureFlagDefinitions.ts`

```typescript
{
  name: 'deskmateFeatureMyNewFeature',
  description: 'My new feature',
  defaultValue: false,  // or use (ctx) => ctx.isDev to restrict to dev only
},
```

## Defined Flags

| Flag | Description | Default |
|------|-------------|---------|
| `deskmateFeatureDevTools` | Developer tools | `false` |
| `deskmateFeatureDebugLogging` | Debug logging | `(ctx) => ctx.isDev` |
| `deskmateFeaturePerformanceMetrics` | Performance metrics | `false` |
| `deskmateFeatureExperimentalChat` | Experimental chat | `(ctx) => ctx.isDev` |
| `deskmateFeatureNewModelSelector` | New model selector | `false` |
| `deskmateFeatureMemoryV2` | Memory V2 | `false` |
| `deskmateFeatureMockApi` | Mock API | `(ctx) => ctx.isDev` |
| `deskmateFeatureMcpDebug` | MCP debug | `false` |

## File Structure

```
src/main/lib/featureFlags/
├── index.ts                    # Export entry point
├── types.ts                    # Type definitions (including FeatureFlagContext)
├── featureFlagDefinitions.ts   # Flag configuration
├── featureFlagManager.ts       # Backend manager
└── README.md

src/renderer/lib/featureFlags/
├── index.ts                    # Export entry point
├── featureFlagCacheManager.ts  # Frontend cache
└── useFeatureFlag.ts           # React hooks
```
