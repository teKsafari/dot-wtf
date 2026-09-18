'use client'

import * as React from 'react'
import {
  ThemeProvider as NextThemesProvider,
  type ThemeProviderProps,
} from 'next-themes'

export function ThemeProvider({
  children,
  scriptProps,
  ...props
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      {...props}
      scriptProps={{
        ...scriptProps,
        type: typeof window === 'undefined' ? 'text/javascript' : 'text/plain',
      }}
    >
      {children}
    </NextThemesProvider>
  )
}
