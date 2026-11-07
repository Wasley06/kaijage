import React from 'react'
import { createRoot } from 'react-dom/client'
import KaijageApp from '../src/app/(frontend)/KaijageApp'
import '../src/app/(frontend)/styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KaijageApp />
  </React.StrictMode>,
)
