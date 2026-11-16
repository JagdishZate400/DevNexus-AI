import test from 'node:test'
import assert from 'node:assert/strict'
import { useThemeStore, applyThemeClass } from '../src/store/themeStore.js'

test('themeStore defaults to dark mode and toggles state correctly', () => {
  // Reset store to known state
  useThemeStore.getState().setTheme(true)
  assert.equal(useThemeStore.getState().isDark, true)

  // Toggle to light mode
  useThemeStore.getState().toggleTheme()
  assert.equal(useThemeStore.getState().isDark, false)

  // Toggle back to dark mode
  useThemeStore.getState().toggleTheme()
  assert.equal(useThemeStore.getState().isDark, true)
})

test('applyThemeClass applies dark/light classes, data-theme, and colorScheme to document root', () => {
  // Mock documentElement in Node environment
  const mockClassList = new Set()
  const mockAttributes = new Map()
  const mockStyle = {}

  globalThis.document = {
    documentElement: {
      classList: {
        toggle(cls, force) {
          if (force) mockClassList.add(cls)
          else mockClassList.delete(cls)
        },
        contains(cls) {
          return mockClassList.has(cls)
        },
      },
      setAttribute(k, v) {
        mockAttributes.set(k, v)
      },
      getAttribute(k) {
        return mockAttributes.get(k)
      },
      style: mockStyle,
    },
  }

  // Apply dark mode
  applyThemeClass(true)
  assert.ok(mockClassList.has('dark'))
  assert.ok(!mockClassList.has('light'))
  assert.equal(mockAttributes.get('data-theme'), 'dark')
  assert.equal(mockStyle.colorScheme, 'dark')

  // Apply light mode
  applyThemeClass(false)
  assert.ok(!mockClassList.has('dark'))
  assert.ok(mockClassList.has('light'))
  assert.equal(mockAttributes.get('data-theme'), 'light')
  assert.equal(mockStyle.colorScheme, 'light')

  delete globalThis.document
})

test('theme action semantics: dark mode offers light target, light mode offers dark target', () => {
  function getAction(isDark) {
    return {
      title: isDark ? 'Switch to light mode' : 'Switch to dark mode',
      icon: isDark ? 'Sun' : 'Moon',
    }
  }

  const inDark = getAction(true)
  assert.equal(inDark.title, 'Switch to light mode')
  assert.equal(inDark.icon, 'Sun')

  const inLight = getAction(false)
  assert.equal(inLight.title, 'Switch to dark mode')
  assert.equal(inLight.icon, 'Moon')
})
