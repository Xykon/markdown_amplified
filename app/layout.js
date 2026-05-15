import './globals.css'
import 'katex/dist/katex.min.css'
import { ThemeProvider } from './ThemeContext'

export const metadata = {
  title: 'Markdown Viewer',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
