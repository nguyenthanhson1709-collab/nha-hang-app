// Kéo thả file vào nút / vùng tải lên (máy tính). Dùng: <label {...dropProps((fl) => upload(fl))}>
import type { DragEvent } from 'react'

export function dropProps(onFiles: (fl: FileList) => void, disabled = false) {
  const has = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files')
  return {
    'data-drop': '1',
    onDragEnter: (e: DragEvent<HTMLElement>) => { if (!has(e) || disabled) return; e.preventDefault(); e.currentTarget.classList.add('drag-over') },
    onDragOver: (e: DragEvent<HTMLElement>) => { if (!has(e) || disabled) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' },
    onDragLeave: (e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.classList.remove('drag-over') },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.currentTarget.classList.remove('drag-over')
      if (!has(e) || disabled) return
      e.preventDefault(); e.stopPropagation()
      if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files)
    },
  }
}

/** Thả file nhầm ra ngoài vùng tải lên thì không để trình duyệt mở file (rời khỏi app) */
export function blockStrayDrops() {
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', (e) => e.preventDefault())
}
