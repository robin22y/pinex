import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, BookOpen } from 'lucide-react';
import { getStats, getAllEntries, exportAsJSON, importFromJSON, getBackupReminder, recordBackup, formatJournalAsMarkdown } from '../lib/journal';

const colors = {
  bg: '#0B0E11',
  surface: '#0F1217',
  card: '#141820',
  border: '#1E2530',
  text: '#E2E8F0',
  muted: '#64748B',
  green: '#00C805',
  red: '#FF3B30',
  blue: '#60A5FA',
  amber: '#FBBF24'
};

export default function Journal() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ watching: 0, owned: 0, sold: 0, reviewsDue: 0 });
  const [entries, setEntries] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [backupDaysSince, setBackupDaysSince] = useState(null);
  const [showExportModal, setShowExportModal] = useState(false);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadData = () => {
    setStats(getStats());
    setEntries(getAllEntries());
    const daysSince = getBackupReminder();
    setBackupDaysSince(daysSince);
  };

  const filteredEntries = entries.filter(e => {
    const matchesSearch = e.ticker.includes(searchTerm.toUpperCase()) ||
                         e.company_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || e.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const handleDownloadBackup = () => {
    exportAsJSON();
    recordBackup();
    setBackupDaysSince(null);
  };

  const handleUploadBackup = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      importFromJSON(file)
        .then(() => {
          loadData();
          alert('Journal restored successfully!');
        })
        .catch(err => alert(`Failed to restore: ${err.message}`));
    }
  };

  const handleAnalyse = () => {
    const markdown = formatJournalAsMarkdown();
    const prompt = `You are an investment psychologist. Below is my complete decision journal. Analyse my behaviour only. Do not recommend stocks. Find recurring mistakes and emotional patterns. Separate process mistakes from emotional mistakes. Give me my top 5 behavioural rules.\n\n\`\`\`\n${markdown}\n\`\`\``;

    const encoded = encodeURIComponent(prompt);
    setShowExportModal(false);
    // Could open in new tabs
  };

  const statCard = (label, count, color) => (
    <div style={{
      padding: '16px',
      backgroundColor: colors.card,
      border: `1px solid ${colors.border}`,
      borderRadius: '8px',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 600, color }}>{count}</div>
    </div>
  );

  return (
    <div style={{ backgroundColor: colors.bg, minHeight: '100vh', paddingBottom: '80px' }}>
      {/* Helmet CSS for forced dark mode */}
      <style>{`
        html, body { background: ${colors.bg} !important; color: ${colors.text} !important; }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen size={20} color={colors.green} />
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Journal</h1>
        </div>
        <button
          onClick={() => navigate('/journal/new')}
          style={{
            background: colors.green,
            color: colors.bg,
            border: 'none',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <Plus size={16} /> New
        </button>
      </div>

      {/* Backup Reminder */}
      {backupDaysSince && (
        <div style={{
          margin: '12px',
          padding: '12px',
          backgroundColor: colors.card,
          border: `1px solid ${colors.amber}`,
          borderRadius: '6px',
          fontSize: '13px',
          color: colors.text
        }}>
          <div style={{ marginBottom: '8px' }}>
            Last backup: <strong>{backupDaysSince} days ago</strong>. Download now to keep your data safe.
          </div>
          <button
            onClick={handleDownloadBackup}
            style={{
              background: colors.amber,
              color: colors.bg,
              border: 'none',
              borderRadius: '4px',
              padding: '6px 10px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Download Backup
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        padding: '16px',
        paddingBottom: '8px'
      }}>
        {statCard('Watching', stats.watching, colors.blue)}
        {statCard('Owned', stats.owned, colors.green)}
        {statCard('Sold', stats.sold, colors.muted)}
        {statCard('Reviews Due', stats.reviewsDue, colors.amber)}
      </div>

      {/* Search & Filter */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={16} style={{
            position: 'absolute',
            left: '10px',
            top: '10px',
            color: colors.muted
          }} />
          <input
            type="text"
            placeholder="Search ticker..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              paddingLeft: '32px',
              paddingRight: '12px',
              paddingTop: '8px',
              paddingBottom: '8px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              color: colors.text,
              fontSize: '14px'
            }}
          />
        </div>
      </div>

      {/* Status Filter */}
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: '8px', overflowX: 'auto' }}>
        {['all', 'watching', 'owned', 'sold'].map(status => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            style={{
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              background: filterStatus === status ? colors.green : colors.card,
              color: filterStatus === status ? colors.bg : colors.text,
              textTransform: 'capitalize',
              whiteSpace: 'nowrap'
            }}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Entries List */}
      <div style={{ padding: '12px 16px' }}>
        {filteredEntries.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '32px 16px',
            color: colors.muted,
            fontSize: '14px'
          }}>
            No entries yet. Start by creating your first decision.
          </div>
        ) : (
          filteredEntries.map(entry => (
            <div
              key={entry.id}
              onClick={() => navigate(`/journal/${entry.ticker}`)}
              style={{
                marginBottom: '12px',
                padding: '14px',
                backgroundColor: colors.card,
                border: `1px solid ${colors.border}`,
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = colors.green}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = colors.border}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text }}>{entry.ticker}</div>
                  <div style={{ fontSize: '12px', color: colors.muted }}>{entry.company_name}</div>
                </div>
                <div style={{
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'capitalize',
                  background: entry.status === 'watching' ? `${colors.blue}20` :
                             entry.status === 'owned' ? `${colors.green}20` : `${colors.red}20`,
                  color: entry.status === 'watching' ? colors.blue :
                        entry.status === 'owned' ? colors.green : colors.red
                }}>
                  {entry.status}
                </div>
              </div>
              <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '6px' }}>
                Entry: {entry.entry_date}
                {entry.review_90day.due_date && ` • Review due: ${entry.review_90day.due_date}`}
              </div>
              <div style={{ fontSize: '12px', color: colors.text }}>
                Confidence: {entry.before_buying.confidence}/10
              </div>
            </div>
          ))
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setShowExportModal(true)}
          style={{
            flex: 1,
            minWidth: '120px',
            padding: '10px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            color: colors.text,
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Analyse Decisions
        </button>
        <button
          onClick={handleDownloadBackup}
          style={{
            flex: 1,
            minWidth: '120px',
            padding: '10px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            color: colors.text,
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          Download Backup
        </button>
        <label style={{
          flex: 1,
          minWidth: '120px',
          padding: '10px',
          backgroundColor: colors.card,
          border: `1px solid ${colors.border}`,
          borderRadius: '6px',
          color: colors.text,
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          textAlign: 'center'
        }}>
          Restore Backup
          <input
            type="file"
            accept=".json"
            onChange={handleUploadBackup}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: colors.card,
            borderRadius: '12px',
            padding: '20px',
            maxWidth: '90%',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px', color: colors.text }}>
              Analyse Your Decisions
            </h2>
            <p style={{ fontSize: '13px', color: colors.muted, marginBottom: '16px' }}>
              Export your journal and analyse your decision patterns with AI.
            </p>
            <div style={{ display: 'flex', gap: '8px', flexDirection: 'column', marginBottom: '16px' }}>
              <button
                onClick={() => {
                  const md = formatJournalAsMarkdown();
                  navigator.clipboard.writeText(md);
                  alert('Journal copied to clipboard!');
                }}
                style={{
                  padding: '10px',
                  backgroundColor: colors.blue,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Copy Journal as Markdown
              </button>
              <button
                onClick={() => {
                  const md = formatJournalAsMarkdown();
                  const prompt = `You are an investment psychologist. Below is my complete decision journal. Analyse my behaviour only. Do not recommend stocks. Find recurring mistakes and emotional patterns. Separate process mistakes from emotional mistakes. Give me my top 5 behavioural rules.\n\n\`\`\`\n${md}\n\`\`\``;
                  navigator.clipboard.writeText(prompt);
                  alert('Prompt copied to clipboard!');
                }}
                style={{
                  padding: '10px',
                  backgroundColor: colors.green,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Copy Analysis Prompt
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button
                onClick={() => window.open('https://chatgpt.com', '_blank')}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Open ChatGPT
              </button>
              <button
                onClick={() => window.open('https://gemini.google.com', '_blank')}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Open Gemini
              </button>
              <button
                onClick={() => window.open('https://claude.ai', '_blank')}
                style={{
                  flex: 1,
                  padding: '8px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Open Claude
              </button>
            </div>
            <button
              onClick={() => setShowExportModal(false)}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: colors.muted,
                color: colors.bg,
                border: 'none',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
