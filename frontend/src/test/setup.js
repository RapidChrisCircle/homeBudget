import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Without this, jsdom's document persists across tests within a file and
// render() calls accumulate DOM instead of replacing it.
afterEach(() => {
  cleanup()
})
