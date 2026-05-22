# Dead Code Cleanup Guidelines

## What to Remove

### 1. Unused State Variables
Look for `useState` that:
- Are initialized but never used
- Are only set, never read
- Have no JSDoc explaining why they exist

Example patterns to search:
```typescript
// ❌ Never read, only set
const [someValue, setSomeValue] = useState(null);
setSomeValue(newValue); // Never used again

// ❌ Never set
const [config] = useState({ /* ... */ });

// ❌ Duplicate functionality
const [isLoading, setIsLoading] = useState(false);
const [loading, setLoading] = useState(false); // Same thing
```

### 2. Commented-Out Code
Remove all:
- Commented-out console.logs
- Commented-out API calls
- Commented-out logic blocks
- Commented-out old implementations

Use git history to recover if needed.

### 3. Duplicate Functions
Search for:
- Multiple `createNotification*` functions doing similar things
- Multiple `format*Date` functions
- Multiple `validate*Input` functions

Consolidate into single utilities in `/lib`.

### 4. Unused Imports
```typescript
// ❌ Imported but never used
import { someFunction } from "@/lib/unused";

// ✅ Actually used
import { someFunction } from "@/lib/utils";
someFunction();
```

### 5. Stale TODOs and FIXMEs
Remove or convert to GitHub issues:
```typescript
// ❌ Vague TODO
// TODO: fix this later

// ❌ Already done
// TODO: add loading skeleton (already exists)

// ✅ Keep - actionable with context
// TODO: Add transaction wrapping when Supabase RLS supports it
```

## Specific Files to Review

### High Priority
- `app/messages/page.tsx` (12,600+ lines, likely has dead code from iterations)
- `app/activity/page.tsx` (1,000+ lines)
- `app/api/activities/route.ts` (750+ lines)
- `app/profile/[id]/page.tsx` (1,000+ lines)

### Medium Priority
- All `/app/api/*/route.ts` files (check for duplicate notification code)
- Component files in `/components` (search for unused props)

## Search Patterns (Use in IDE)

### Find commented code
```
Search: ^[\s]*\/\/[\s]*[a-z]
Regex: true
```

### Find unused imports
```
Search: ^import.*from
Regex: true
Then manually check each
```

### Find unused state
```
Search: useState\(.*?\)
Regex: true
Then check if variable is referenced
```

## Before/After Example

### Before
```typescript
// Old activity loading code - do not use
// const [activities, setActivities] = useState<Activity[]>([]);
// const [activityLoading, setActivityLoading] = useState(false);
// const loadActivities = async () => {
//   setActivityLoading(true);
//   const res = await fetch('/api/activities');
//   setActivities(await res.json());
//   setActivityLoading(false);
// };

const [threads, setThreads] = useState<Thread[]>([]);
const [threadLoading, setThreadLoading] = useState(false);

// TODO: refactor this later
const loadThreads = async () => {
  threadLoading && setThreadLoading(true);
  // ... similar code to above ...
};
```

### After
```typescript
const [threads, setThreads] = useState<Thread[]>([]);
const [threadLoading, setThreadLoading] = useState(false);

const loadThreads = async () => {
  setThreadLoading(true);
  try {
    const res = await fetch('/api/threads');
    if (!res.ok) throw new Error('Failed to load threads');
    setThreads(await res.json());
  } finally {
    setThreadLoading(false);
  }
};
```

## Cleanup Steps

1. **Commented code**: Delete all `//` and `/* */` code blocks
2. **Unused variables**: Remove any declared but unreferenced state/variables
3. **Duplicate functions**: Create consolidated versions in `/lib`
4. **Unused imports**: Remove import statements not referenced in file
5. **Stale TODOs**: Convert actionable ones to issues, delete vague ones
6. **Test**: Run TypeScript compiler to verify no breaking changes
   ```bash
   tsc --noEmit
   ```

## Files Already Cleaned
- (None yet - this is the checklist for the first pass)
