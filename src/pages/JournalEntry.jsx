import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronUp, Plus, Trash2, Edit2 } from 'lucide-react';
import { getEntry, addHoldingReview, updateAfterSelling, updateWhileHolding, update90DayReview, deleteEntry, updateBeforeBuying, calculateProfitLoss } from '../lib/journal';

const colors = {
  bg: 'var(--bg-primary)',
  surface: 'var(--bg-surface)',
  card: 'var(--bg-elevated)',
  border: 'var(--border)',
  text: 'var(--text-primary)',
  muted: 'var(--text-muted)',
  green: 'var(--positive)',
  red: 'var(--negative)',
  blue: 'var(--info)',
  amber: 'var(--warning)'
};

const TimelineItem = ({ date, label, children, defaultOpen = false, onEdit = null }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: '16px' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: colors.card,
          border: `1px solid ${colors.border}`,
          borderRadius: '6px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          color: colors.text,
          fontSize: '13px',
          fontWeight: 600
        }}
      >
        <div style={{ textAlign: 'left', flex: 1 }}>
          <div style={{ color: colors.muted, fontSize: '11px', marginBottom: '2px' }}>{date}</div>
          <div>{label}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: colors.blue,
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Edit section"
            >
              <Edit2 size={14} />
            </button>
          )}
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>
      {open && (
        <div style={{
          marginTop: '8px',
          padding: '12px',
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: '6px',
          fontSize: '13px',
          color: colors.text,
          lineHeight: '1.5'
        }}>
          {children}
        </div>
      )}
    </div>
  );
};

export default function JournalEntry() {
  const { ticker } = useParams();
  const navigate = useNavigate();
  const [entry, setEntry] = useState(null);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showSoldForm, setShowSoldForm] = useState(false);
  const [show90Form, setShow90Form] = useState(false);
  const [editMode, setEditMode] = useState(null); // 'before', 'while', 'after', null
  const [reviewForm, setReviewForm] = useState({
    date: new Date().toISOString().split('T')[0],
    reason: 'price_movement',
    thesis_changed: 'no',
    action: 'hold',
    confidence: 5,
    notes: ''
  });
  const [soldForm, setSoldForm] = useState({
    date_sold: new Date().toISOString().split('T')[0],
    avg_exit: '',
    profit_loss: null,
    why_sold: '',
    thesis_failed: '',
    emotions_influenced: '',
    would_buy_again: '',
    what_learned: ''
  });
  const [review90Form, setReview90Form] = useState({
    thesis_correct: '',
    company_better_than_expected: '',
    sold_too_early: '',
    same_decision_again: '',
    process_score: 5
  });
  const [editBeforeBuyingForm, setEditBeforeBuyingForm] = useState({});
  const [editWhileHoldingForm, setEditWhileHoldingForm] = useState({
    hold_criteria: '',
    sell_triggers: ''
  });
  const [editAfterSellingForm, setEditAfterSellingForm] = useState({});

  useEffect(() => {
    const loaded = getEntry(ticker);
    setEntry(loaded);
    if (loaded) {
      setEditBeforeBuyingForm(loaded.before_buying);
      setEditWhileHoldingForm(loaded.while_holding || { hold_criteria: '', sell_triggers: '' });
      setEditAfterSellingForm(loaded.after_selling || {
        date_sold: null,
        avg_exit: null,
        profit_loss: null,
        why_sold: '',
        thesis_failed: '',
        emotions_influenced: '',
        would_buy_again: '',
        what_learned: ''
      });
    }
  }, [ticker]);

  const handleDelete = () => {
    if (window.confirm(`Delete ${ticker}? This cannot be undone.`)) {
      deleteEntry(ticker);
      navigate('/journal');
    }
  };

  const handleSaveBeforeBuyingEdit = () => {
    updateBeforeBuying(ticker, editBeforeBuyingForm);
    const updated = getEntry(ticker);
    setEntry(updated);
    setEditMode(null);
  };

  const handleSaveWhileHoldingEdit = () => {
    updateWhileHolding(ticker, editWhileHoldingForm);
    const updated = getEntry(ticker);
    setEntry(updated);
    setEditMode(null);
  };

  const handleSaveAfterSellingEdit = () => {
    updateAfterSelling(ticker, editAfterSellingForm);
    const updated = getEntry(ticker);
    setEntry(updated);
    setEditMode(null);
  };

  if (!entry) {
    return (
      <div style={{ backgroundColor: colors.bg, minHeight: '100vh', padding: '16px', color: colors.text }}>
        Entry not found
      </div>
    );
  }

  const handleAddReview = () => {
    addHoldingReview(ticker, reviewForm);
    const updated = getEntry(ticker);
    setEntry(updated);
    setShowReviewForm(false);
    setReviewForm({
      date: new Date().toISOString().split('T')[0],
      reason: 'price_movement',
      thesis_changed: 'no',
      action: 'hold',
      confidence: 5,
      notes: ''
    });
  };

  const handleMarkSold = () => {
    updateAfterSelling(ticker, soldForm);
    const updated = getEntry(ticker);
    setEntry(updated);
    setShowSoldForm(false);
  };

  const handleComplete90Day = () => {
    update90DayReview(ticker, review90Form);
    const updated = getEntry(ticker);
    setEntry(updated);
    setShow90Form(false);
  };

  const fieldDisplay = (label, value) => (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '11px', color: colors.muted, marginBottom: '4px', fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: '13px', color: colors.text }}>
        {value || '(not provided)'}
      </div>
    </div>
  );

  return (
    <div style={{ backgroundColor: colors.bg, minHeight: '100vh', paddingBottom: '80px' }}>
      <style>{`html, body { background: ${colors.bg} !important; color: ${colors.text} !important; }`}</style>

      {/* Header with Status */}
      <div style={{
        padding: '16px',
        borderBottom: `1px solid ${colors.border}`
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px'
        }}>
          <button
            onClick={() => navigate('/journal')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: colors.text,
              padding: '4px'
            }}
          >
            <ChevronLeft size={20} />
          </button>
          <div style={{ textAlign: 'center', flex: 1 }}>
            <div style={{ fontSize: '16px', fontWeight: 600 }}>{entry.ticker}</div>
            <div style={{ fontSize: '12px', color: colors.muted }}>{entry.company_name}</div>
          </div>
          <button
            onClick={handleDelete}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: colors.red,
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Delete entry"
          >
            <Trash2 size={18} />
          </button>
        </div>

        {/* Status Timeline */}
        <div style={{
          padding: '12px',
          backgroundColor: colors.card,
          borderRadius: '6px',
          fontSize: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{
              padding: '4px 10px',
              borderRadius: '4px',
              fontWeight: 600,
              background: entry.status === 'owned' || entry.status === 'sold' ? colors.green : colors.blue,
              color: colors.bg,
              textTransform: 'uppercase'
            }}>
              🛒 BOUGHT {entry.entry_date}
            </div>
            {entry.status === 'owned' && (
              <div style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontWeight: 600,
                background: colors.amber,
                color: colors.bg,
                textTransform: 'uppercase'
              }}>
                📊 HOLDING ({entry.holding_reviews.length} reviews)
              </div>
            )}
            {entry.status === 'sold' && entry.after_selling.date_sold && (
              <div style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontWeight: 600,
                background: colors.red,
                color: colors.bg,
                textTransform: 'uppercase'
              }}>
                💰 SOLD {entry.after_selling.date_sold}
              </div>
            )}
          </div>
          <div style={{ color: colors.muted, fontSize: '11px' }}>
            {entry.status === 'watching' && '📍 On watchlist'}
            {entry.status === 'owned' && 'Currently holding — Record daily holding decisions'}
            {entry.status === 'sold' && 'Exit recorded — Complete 90-day review when due'}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ padding: '16px' }}>
        {/* STATUS-AWARE LAYOUT */}

        {/* PHASE 1: BEFORE BUYING (watching status) */}
        {entry.status === 'watching' && (
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: colors.text, marginBottom: '12px' }}>
            📌 BEFORE BUYING — Ready to enter?
          </div>

        {/* Before Buying - Card Layout */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{
            padding: '12px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            marginBottom: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <div style={{ fontSize: '12px', color: colors.muted, marginBottom: '4px' }}>Before Buying</div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: colors.text }}>{entry.entry_date}</div>
            </div>
            <button
              onClick={() => setEditMode('before')}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: colors.blue,
                padding: '4px',
                display: 'flex',
                alignItems: 'center'
              }}
              title="Edit before buying"
            >
              <Edit2 size={14} />
            </button>
          </div>

          {/* Basic Info Card */}
          <div style={{
            padding: '14px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            marginBottom: '12px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: colors.muted, marginBottom: '12px', textTransform: 'uppercase' }}>Basic</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {fieldDisplay('Ticker', entry.ticker)}
              {fieldDisplay('Company', entry.company_name)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              {fieldDisplay('Avg Price', entry.before_buying.avg_price || '—')}
              {fieldDisplay('Position Size', entry.before_buying.position_size || '—')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {fieldDisplay('Max Allocation', entry.before_buying.max_allocation || '—')}
              {fieldDisplay('Confidence', `${entry.before_buying.confidence}/10`)}
            </div>
          </div>

          {/* Investment Thesis Card */}
          <div style={{
            padding: '14px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            marginBottom: '12px'
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: colors.muted, marginBottom: '8px', textTransform: 'uppercase' }}>Investment Thesis</div>
            <div style={{ fontSize: '13px', color: colors.text, lineHeight: '1.5' }}>
              {entry.before_buying.thesis || '(not provided)'}
            </div>
          </div>

          {/* Analysis Cards */}
          {['Fundamental Reasons', 'Technical Reasons', 'Expected Catalysts', 'Biggest Risks', 'Competition', 'What Must Go Right', 'What Could Break My Thesis', 'Conditions to Sell'].map(field => {
            const key = field.toLowerCase().replace(/ /g, '_');
            return (
              <div key={field} style={{
                padding: '14px',
                backgroundColor: colors.card,
                border: `1px solid ${colors.border}`,
                borderRadius: '8px',
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: colors.muted, marginBottom: '8px', textTransform: 'uppercase' }}>{field}</div>
                <div style={{ fontSize: '13px', color: colors.text, lineHeight: '1.5' }}>
                  {entry.before_buying[key] || '(not provided)'}
                </div>
              </div>
            );
          })}

          {/* Mandatory Warnings Card */}
          <div style={{
            padding: '14px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.amber}`,
            borderRadius: '8px',
            marginBottom: '12px'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: colors.amber, marginBottom: '6px', textTransform: 'uppercase' }}>⚠ Why I Might Be Wrong</div>
                <div style={{ fontSize: '13px', color: colors.text, lineHeight: '1.5' }}>
                  {entry.before_buying.why_i_might_be_wrong || '(not provided)'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: colors.amber, marginBottom: '6px', textTransform: 'uppercase' }}>⚠ Bear Case</div>
                <div style={{ fontSize: '13px', color: colors.text, lineHeight: '1.5' }}>
                  {entry.before_buying.bear_case || '(not provided)'}
                </div>
              </div>
            </div>
          </div>

          {/* Emotional Check & Checklist Card */}
          <div style={{
            padding: '14px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '8px',
            marginBottom: '12px'
          }}>
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: colors.muted, marginBottom: '8px', textTransform: 'uppercase' }}>Emotional Check</div>
              <div style={{ fontSize: '13px', color: colors.text, textTransform: 'capitalize' }}>
                {entry.before_buying.emotional_state}
              </div>
            </div>
            <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: colors.muted, marginBottom: '10px', textTransform: 'uppercase' }}>Pre-Entry Checklist</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                {Object.entries(entry.before_buying.checklist).map(([key, value]) => (
                  <div key={key} style={{ color: colors.text }}>
                    {value ? '✓' : '○'} {key.replace(/_/g, ' ').charAt(0).toUpperCase() + key.replace(/_/g, ' ').slice(1)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        </div>
        )}

        {/* PHASE 2: HOLDING (owned status) */}
        {entry.status === 'owned' && (
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: colors.text, marginBottom: '12px' }}>
              📊 DAILY HOLDING DECISIONS — Track your thesis
            </div>
          </div>
        )}

        {/* Holding Reviews - Daily Decisions */}
        {entry.holding_reviews.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{
              padding: '12px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '8px',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: colors.text }}>
                📊 Holding Decisions ({entry.holding_reviews.length} recorded)
              </div>
            </div>
            {entry.holding_reviews.map((review, idx) => (
              <TimelineItem
                key={review.id}
                date={review.date}
                label={`Day ${idx + 1} — ${review.action.toUpperCase()}`}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  {fieldDisplay('Reason', review.reason)}
                  {fieldDisplay('Action', review.action)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  {fieldDisplay('Thesis Changed', review.thesis_changed)}
                  {fieldDisplay('Confidence', `${review.confidence}/10`)}
                </div>
                {review.notes && fieldDisplay('Notes', review.notes)}
              </TimelineItem>
            ))}
          </div>
        )}

        {/* Add Today's Holding Decision Button */}
        {entry.status === 'owned' && (
          <button
            onClick={() => setShowReviewForm(true)}
            style={{
              width: '100%',
              padding: '14px',
              marginBottom: '16px',
              backgroundColor: colors.amber,
              border: 'none',
              borderRadius: '6px',
              color: colors.bg,
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Plus size={18} /> Add Today's Holding Decision
          </button>
        )}

        {/* While Holding / Post-Buying Criteria */}
        {entry.status === 'owned' && (
          <TimelineItem
            date={new Date().toISOString().split('T')[0]}
            label="While Holding"
            onEdit={() => setEditMode('while')}
          >
            {fieldDisplay('Criteria to Hold', entry.while_holding?.hold_criteria)}
            {fieldDisplay('Reasons You Might Sell', entry.while_holding?.sell_triggers)}
          </TimelineItem>
        )}

        {/* Why Sold - Critical Analysis */}
        {entry.status === 'sold' && entry.after_selling.date_sold && (
          <TimelineItem
            date={entry.after_selling.date_sold}
            label="💰 Why Sold - Exit Analysis"
            onEdit={() => setEditMode('after')}
          >
            <div style={{ marginBottom: '12px' }}>
              {entry.after_selling.avg_exit && (
                <div style={{
                  padding: '12px',
                  backgroundColor: colors.surface,
                  borderRadius: '6px',
                  marginBottom: '12px'
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: entry.after_selling.profit_loss ? '12px' : '0' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: colors.muted, marginBottom: '4px' }}>Entry Price</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: colors.green }}>{entry.before_buying.avg_price || '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '11px', color: colors.muted, marginBottom: '4px' }}>Exit Price</div>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: colors.text }}>{entry.after_selling.avg_exit}</div>
                    </div>
                  </div>
                  {entry.after_selling.profit_loss && (
                    <div style={{
                      padding: '8px',
                      backgroundColor: colors.card,
                      borderRadius: '4px',
                      textAlign: 'center'
                    }}>
                      <div style={{ fontSize: '11px', color: colors.muted, marginBottom: '4px' }}>Profit/Loss</div>
                      <div style={{
                        fontSize: '16px',
                        fontWeight: 700,
                        color: entry.after_selling.profit_loss.includes('-') ? colors.red : colors.green
                      }}>
                        {entry.after_selling.profit_loss}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {fieldDisplay('Why I Sold', entry.after_selling.why_sold)}
            {fieldDisplay('Did My Thesis Fail', entry.after_selling.thesis_failed)}
            {fieldDisplay('Emotions Influenced This', entry.after_selling.emotions_influenced)}
            {fieldDisplay('Would Buy Again Today', entry.after_selling.would_buy_again)}
            {fieldDisplay('What I Learned', entry.after_selling.what_learned)}
          </TimelineItem>
        )}

        {/* Mark as Sold Button */}
        {entry.status === 'owned' && (
          <>
            <div style={{
              padding: '12px',
              marginBottom: '12px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              color: colors.text,
              fontSize: '12px',
              lineHeight: '1.5'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '6px', color: colors.amber }}>⚠️ Ready to Exit?</div>
              <div style={{ color: colors.muted }}>Record EXACTLY why you sold. This analysis matters more than the price.</div>
            </div>
            <button
              onClick={() => setShowSoldForm(true)}
              style={{
                width: '100%',
                padding: '14px',
                marginBottom: '16px',
                backgroundColor: colors.red,
                color: colors.bg,
                border: 'none',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              💰 Mark as Sold & Record Why
            </button>
          </>
        )}

        {/* 90 Day Review - Final Analysis */}
        {entry.review_90day.completed && (
          <TimelineItem
            date={new Date().toISOString().split('T')[0]}
            label="📋 90 Day Review - Was I Right?"
          >
            {fieldDisplay('Was My Thesis Correct', entry.review_90day.thesis_correct)}
            {fieldDisplay('Company Better Than Expected', entry.review_90day.company_better_than_expected)}
            {fieldDisplay('Did I Sell Too Early', entry.review_90day.sold_too_early)}
            {fieldDisplay('Would Make Same Decision', entry.review_90day.same_decision_again)}
            {fieldDisplay('Process Score', `${entry.review_90day.process_score}/10`)}
          </TimelineItem>
        )}

        {/* 90 Day Review Button / Pending Status */}
        {entry.status === 'sold' && !entry.review_90day.completed && (
          <>
            <div style={{
              padding: '12px',
              marginBottom: '12px',
              backgroundColor: colors.amber,
              border: `1px solid ${colors.amber}`,
              borderRadius: '6px',
              color: colors.bg,
              fontSize: '13px',
              fontWeight: 600,
              textAlign: 'center'
            }}>
              📋 Review Pending — 90 days after sale
            </div>
            <button
              onClick={() => setShow90Form(true)}
              style={{
                width: '100%',
                padding: '12px',
                marginBottom: '16px',
                backgroundColor: colors.amber,
                color: colors.bg,
                border: 'none',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Complete 90 Day Review
            </button>
          </>
        )}
      </div>

      {/* Holding Review Form Modal */}
      {showReviewForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'flex-end',
          zIndex: 1000
        }}>
          <div style={{
            width: '100%',
            backgroundColor: colors.card,
            borderRadius: '12px 12px 0 0',
            border: `1px solid ${colors.border}`,
            borderBottom: 'none',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: '80px'
          }}>
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px',
              paddingBottom: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.text, margin: 0 }}>
                  Add Holding Review
                </h2>
                <button
                  onClick={() => setShowReviewForm(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '24px',
                    color: colors.text,
                    cursor: 'pointer',
                    padding: '0',
                    width: '24px',
                    height: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  ✕
                </button>
              </div>
              <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Date
              </label>
              <input
                type="date"
                value={reviewForm.date}
                onChange={(e) => setReviewForm({ ...reviewForm, date: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  marginBottom: '16px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Reason
              </label>
              <select
                value={reviewForm.reason}
                onChange={(e) => setReviewForm({ ...reviewForm, reason: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  boxSizing: 'border-box'
                }}
              >
                <option value="news">News</option>
                <option value="price_movement">Price Movement</option>
                <option value="business_change">Business Change</option>
                <option value="technical_change">Technical Change</option>
                <option value="nothing_changed">Nothing Changed</option>
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Did My Thesis Change?
              </label>
              <select
                value={reviewForm.thesis_changed}
                onChange={(e) => setReviewForm({ ...reviewForm, thesis_changed: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  boxSizing: 'border-box'
                }}
              >
                <option value="no">No</option>
                <option value="slightly">Slightly</option>
                <option value="yes">Yes</option>
                <option value="broken">Broken</option>
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Action
              </label>
              <select
                value={reviewForm.action}
                onChange={(e) => setReviewForm({ ...reviewForm, action: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  boxSizing: 'border-box'
                }}
              >
                <option value="hold">Hold</option>
                <option value="reduce">Reduce</option>
                <option value="add">Add</option>
                <option value="exit">Exit</option>
              </select>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: colors.text }}>
                Confidence: <span style={{ color: colors.green }}>{ reviewForm.confidence}/10</span>
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={reviewForm.confidence}
                onChange={(e) => setReviewForm({ ...reviewForm, confidence: parseInt(e.target.value) })}
                style={{ width: '100%', marginBottom: '16px' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Notes
              </label>
              <textarea
                value={reviewForm.notes}
                onChange={(e) => setReviewForm({ ...reviewForm, notes: e.target.value })}
                rows={3}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            </div>

            <div style={{
              display: 'flex',
              gap: '8px',
              padding: '16px 20px',
              borderTop: `1px solid ${colors.border}`,
              backgroundColor: colors.card
            }}>
              <button
                onClick={() => setShowReviewForm(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleAddReview}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.green,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Save Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sold Form Modal */}
      {showSoldForm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'flex-end',
          zIndex: 1000
        }}>
          <div style={{
            width: '100%',
            backgroundColor: colors.card,
            borderRadius: '12px 12px 0 0',
            border: `1px solid ${colors.border}`,
            borderBottom: 'none',
            maxHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: '80px'
          }}>
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '20px',
              paddingBottom: '16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.text, margin: 0 }}>
                  Mark as Sold
                </h2>
                <button
                  onClick={() => setShowSoldForm(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                  fontSize: '24px',
                  color: colors.text,
                  cursor: 'pointer',
                  padding: '0',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Date Sold
              </label>
              <input
                type="date"
                value={soldForm.date_sold}
                onChange={(e) => setSoldForm({ ...soldForm, date_sold: e.target.value })}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                  Average Exit Price
                </label>
                <input
                  type="text"
                  value={soldForm.avg_exit}
                  onChange={(e) => setSoldForm({ ...soldForm, avg_exit: e.target.value })}
                  placeholder="Optional"
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    color: colors.text,
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                  Profit/Loss
                </label>
                <input
                  type="text"
                  value={soldForm.profit_loss || ''}
                  onChange={(e) => setSoldForm({ ...soldForm, profit_loss: e.target.value })}
                  placeholder="Optional (e.g. +25% or -$500)"
                  style={{
                    width: '100%',
                    padding: '10px',
                    backgroundColor: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '6px',
                    color: colors.text,
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Why I Sold
              </label>
              <textarea
                value={soldForm.why_sold}
                onChange={(e) => setSoldForm({ ...soldForm, why_sold: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Did My Thesis Fail?
              </label>
              <textarea
                value={soldForm.thesis_failed}
                onChange={(e) => setSoldForm({ ...soldForm, thesis_failed: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Did Emotions Influence This?
              </label>
              <textarea
                value={soldForm.emotions_influenced}
                onChange={(e) => setSoldForm({ ...soldForm, emotions_influenced: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Would I Buy Again Today?
              </label>
              <textarea
                value={soldForm.would_buy_again}
                onChange={(e) => setSoldForm({ ...soldForm, would_buy_again: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                What Did This Teach Me?
              </label>
              <textarea
                value={soldForm.what_learned}
                onChange={(e) => setSoldForm({ ...soldForm, what_learned: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            </div>

            <div style={{
              display: 'flex',
              gap: '8px',
              padding: '16px 20px',
              borderTop: `1px solid ${colors.border}`,
              backgroundColor: colors.card
            }}>
              <button
                onClick={() => setShowSoldForm(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleMarkSold}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.red,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Mark Sold
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 90 Day Review Form Modal */}
      {show90Form && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'flex-end',
          zIndex: 1000
        }}>
          <div style={{
            width: '100%',
            backgroundColor: colors.card,
            borderRadius: '12px 12px 0 0',
            padding: '20px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: colors.text }}>
              90 Day Review
            </h2>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Was My Original Thesis Correct?
              </label>
              <textarea
                value={review90Form.thesis_correct}
                onChange={(e) => setReview90Form({ ...review90Form, thesis_correct: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Was the Company Better Than Expected?
              </label>
              <textarea
                value={review90Form.company_better_than_expected}
                onChange={(e) => setReview90Form({ ...review90Form, company_better_than_expected: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Did I Sell Too Early?
              </label>
              <textarea
                value={review90Form.sold_too_early}
                onChange={(e) => setReview90Form({ ...review90Form, sold_too_early: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Would I Make the Same Decision Again?
              </label>
              <textarea
                value={review90Form.same_decision_again}
                onChange={(e) => setReview90Form({ ...review90Form, same_decision_again: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: colors.text }}>
                Process Score: <span style={{ color: colors.green }}>{review90Form.process_score}/10</span>
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={review90Form.process_score}
                onChange={(e) => setReview90Form({ ...review90Form, process_score: parseInt(e.target.value) })}
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShow90Form(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleComplete90Day}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.amber,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Complete Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Before Buying Modal */}
      {editMode === 'before' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'flex-end',
          zIndex: 1000
        }}>
          <div style={{
            width: '100%',
            backgroundColor: colors.card,
            borderRadius: '12px 12px 0 0',
            padding: '20px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.text, margin: 0 }}>
                Edit Before Buying
              </h2>
              <button
                onClick={() => setEditMode(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: colors.muted,
                  fontSize: '24px',
                  padding: '0',
                  lineHeight: '1'
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Thesis
              </label>
              <textarea
                value={editBeforeBuyingForm.thesis || ''}
                onChange={(e) => setEditBeforeBuyingForm({ ...editBeforeBuyingForm, thesis: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Fundamental Reasons
              </label>
              <textarea
                value={editBeforeBuyingForm.fundamental_reasons || ''}
                onChange={(e) => setEditBeforeBuyingForm({ ...editBeforeBuyingForm, fundamental_reasons: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Technical Reasons
              </label>
              <textarea
                value={editBeforeBuyingForm.technical_reasons || ''}
                onChange={(e) => setEditBeforeBuyingForm({ ...editBeforeBuyingForm, technical_reasons: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{
              padding: '12px',
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              marginBottom: '16px'
            }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Why I Might Be Wrong
              </label>
              <textarea
                value={editBeforeBuyingForm.why_i_might_be_wrong || ''}
                onChange={(e) => setEditBeforeBuyingForm({ ...editBeforeBuyingForm, why_i_might_be_wrong: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.card,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  marginBottom: '12px'
                }}
              />
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Bear Case
              </label>
              <textarea
                value={editBeforeBuyingForm.bear_case || ''}
                onChange={(e) => setEditBeforeBuyingForm({ ...editBeforeBuyingForm, bear_case: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.card,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setEditMode(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBeforeBuyingEdit}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.blue,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit While Holding Modal */}
      {editMode === 'while' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'flex-end',
          zIndex: 1000
        }}>
          <div style={{
            width: '100%',
            backgroundColor: colors.card,
            borderRadius: '12px 12px 0 0',
            padding: '20px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.text, margin: 0 }}>
                Edit While Holding
              </h2>
              <button
                onClick={() => setEditMode(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: colors.muted,
                  fontSize: '24px',
                  padding: '0',
                  lineHeight: '1'
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Criteria to Keep Holding
              </label>
              <textarea
                value={editWhileHoldingForm.hold_criteria || ''}
                onChange={(e) => setEditWhileHoldingForm({ ...editWhileHoldingForm, hold_criteria: e.target.value })}
                rows={3}
                placeholder="What conditions justify keeping this position? Price targets, news events, earnings milestones, etc."
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Reasons You Might Sell
              </label>
              <textarea
                value={editWhileHoldingForm.sell_triggers || ''}
                onChange={(e) => setEditWhileHoldingForm({ ...editWhileHoldingForm, sell_triggers: e.target.value })}
                rows={3}
                placeholder="What would trigger a sell? Loss limits, thesis breaks, profit targets, changed fundamentals, etc."
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setEditMode(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveWhileHoldingEdit}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.green,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit After Selling Modal */}
      {editMode === 'after' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'flex-end',
          zIndex: 1000
        }}>
          <div style={{
            width: '100%',
            backgroundColor: colors.card,
            borderRadius: '12px 12px 0 0',
            padding: '20px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: colors.text, margin: 0 }}>
                Edit After Selling
              </h2>
              <button
                onClick={() => setEditMode(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: colors.muted,
                  fontSize: '24px',
                  padding: '0',
                  lineHeight: '1'
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Why I Sold
              </label>
              <textarea
                value={editAfterSellingForm.why_sold || ''}
                onChange={(e) => setEditAfterSellingForm({ ...editAfterSellingForm, why_sold: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Did My Thesis Fail?
              </label>
              <textarea
                value={editAfterSellingForm.thesis_failed || ''}
                onChange={(e) => setEditAfterSellingForm({ ...editAfterSellingForm, thesis_failed: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                Did Emotions Influence This?
              </label>
              <textarea
                value={editAfterSellingForm.emotions_influenced || ''}
                onChange={(e) => setEditAfterSellingForm({ ...editAfterSellingForm, emotions_influenced: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: colors.text }}>
                What I Learned
              </label>
              <textarea
                value={editAfterSellingForm.what_learned || ''}
                onChange={(e) => setEditAfterSellingForm({ ...editAfterSellingForm, what_learned: e.target.value })}
                rows={2}
                style={{
                  width: '100%',
                  padding: '10px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setEditMode(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '6px',
                  color: colors.text,
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveAfterSellingEdit}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: colors.red,
                  color: colors.bg,
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
