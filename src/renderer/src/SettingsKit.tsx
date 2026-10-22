// Settings' own building blocks: a setting's title and hint, a titled card of settings (Group), a section's scope note.
// Settings.tsx re-exports it.
import { type ReactNode } from 'react'

// a switch row's text: what it is, and under it a line on what it does
export const Says = ({ title, hint }: { title: ReactNode; hint?: ReactNode }) => (
  <span className="switch-text">
    <span>{title}</span>
    {hint && <span className="muted">{hint}</span>}
  </span>
)

// a block of settings that belong together, set apart from the next: a title, what it's for, then them
export const Group = ({ title, hint, act, children }: { title: string; hint?: ReactNode; act?: ReactNode; children: ReactNode }) => (
  <section className="set-group">
    <div className={`set-head ${act ? 'with-act' : ''}`}>
      <h3>{title}</h3>
      {hint && <p className="muted small">{hint}</p>}
      {act && <span className="set-act">{act}</span>}
    </div>
    {children}
  </section>
)

// a list's note (Prompt templates, Actions): Global, everywhere; This project, here only, with the global ones
export const Scope = ({ tag, children }: { tag: string; children: ReactNode }) => (
  <div className="set-scope">
    <span className="tag set-scope-tag">{tag}</span>
    <span>{children}</span>
  </div>
)
