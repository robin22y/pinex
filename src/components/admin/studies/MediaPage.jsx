/** /admin/media — study media library (upload, search, used-by, edit, delete). */
import { useState } from 'react'
import MediaLibrary from './MediaLibrary.jsx'
import MediaUploader from './MediaUploader.jsx'
import { Button, Notice } from './ui.jsx'

export default function MediaPage() {
  const [uploading, setUploading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [notice, setNotice] = useState(null)
  return (
    <div className="sa-page">
      <div className="sa-row sa-row-between">
        <h1 className="sa-h1">Media library</h1>
        <Button variant="primary" onClick={() => setUploading((u) => !u)}>
          {uploading ? 'Close upload' : '+ Upload image'}
        </Button>
      </div>
      {uploading && (
        <div className="sa-panel">
          <MediaUploader
            onUploaded={(m, notes) => {
              setRefresh((r) => r + 1)
              setUploading(false)
              setNotice([`Uploaded “${m.alt_text}”.`, ...(notes || [])].join(' '))
            }}
          />
        </div>
      )}
      <Notice kind="ok" onDismiss={() => setNotice(null)}>
        {notice}
      </Notice>
      <MediaLibrary refreshKey={refresh} />
    </div>
  )
}
