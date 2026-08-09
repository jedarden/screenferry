# Test Runner Identification for roundtrip-integration.test.ts

## Task Summary
Identified and verified the test runner and configuration for `roundtrip-integration.test.ts`.

## Test Runner
**Vitest** - A fast unit test framework with native ESM support

## Test File Location
`/home/coding/screenferry/test/roundtrip-integration.test.ts`

## Test Configuration

### Package.json Scripts
- **Main test command**: `npm test` (runs `vitest run`)
- **Watch mode**: `npm run test:watch` (runs `vitest`)
- **Full gate**: `npm run gate` (runs typecheck, lint, test, and custom gates)

### Vite Configuration (`vite.config.ts`)
```typescript
test: {
  environment: 'jsdom',
  globals: true,
  setupFiles: ['./test/setup.ts'],
},
```

### Test Setup File
`/home/coding/screenferry/test/setup.ts` - Provides:
- Mock OPFS (Origin Private File System) storage
- Mock browser APIs not available in Node/jsdom environment
- ImageData polyfill for canvas operations
- MediaStream and getUserMedia mocks

## How to Run Tests

### Run all tests
```bash
npm test
```

### Run specific test file
```bash
npx vitest run test/roundtrip-integration.test.ts
```

### Run with watch mode
```bash
npm run test:watch
```

### Run with coverage
```bash
npx vitest run --coverage
```

## Test Environment
- **Runtime**: Node.js with jsdom browser simulation
- **Module type**: ESM (`"type": "module"` in package.json)
- **File extension**: `.ts` (TypeScript)
- **Global test APIs**: Available via `globals: true` (describe, it, expect, etc.)

## Key Dependencies
- `vitest: 2.1.4` - Test framework
- `jsdom: 24.1.3` - DOM implementation
- `typescript: 5.6.3` - TypeScript compiler
- `vite: 5.4.10` - Build tool and test environment

## Test File Structure
The test file uses standard vitest patterns:
```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
```

Tests are organized in describe blocks with:
- `beforeEach`/`afterEach` hooks for setup/teardown
- Memory sampling helpers for performance testing
- Integration-style tests covering the full encode→decode pipeline

## Verification Status
✅ Test runner identified: Vitest
✅ Test file confirmed: `/home/coding/screenferry/test/roundtrip-integration.test.ts`
✅ Configuration documented: vite.config.ts + package.json
✅ Execution commands documented: npm test, npx vitest run
✅ Setup files located: test/setup.ts with comprehensive browser API mocks
