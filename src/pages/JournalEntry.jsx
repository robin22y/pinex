import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, ChevronUp, Plus } from 'lucide-react';
import { getEntry, addHoldingReview, updateAfterSelling, update90DayReview } from '../lib/journal';

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

const TimelineItem = ({ date, label, children, defaultOpen = false }) => {
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
        <div style={{ textAlign: 'left' }}>
          <div style={{ color: colors.muted, fontSize: '11px', marginBottom: '2px' }}>{date}</div>
          <div>{label}</div>
        </div>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
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

  useEffect(() => {
    const loaded = getEntry(ticker);
    setEntry(loaded);
  }, [ticker]);

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

      {/* Header */}
      <div style={{
        padding: '16px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
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

      {/* Timeline */}
      <div style={{ padding: '16px' }}>
        {/* Before Buying */}
        <TimelineItem
          date={entry.entry_date}
          label="Before Buying"
          defaultOpen={true}
        >
          {fieldDisplay('Thesis', entry.before_buying.thesis)}
          {fieldDisplay('Fundamental Reasons', entry.before_buying.fundamental_reasons)}
          {fieldDisplay('Technical Reasons', entry.before_buying.technical_reasons)}
          {fieldDisplay('Expected Catalysts', entry.before_buying.expected_catalysts)}
          {fieldDisplay('Biggest Risks', entry.before_buying.biggest_risks)}
          {fieldDisplay('What Must Go Right', entry.before_buying.what_must_go_right)}
          {fieldDisplay('Conditions to Sell', entry.before_buying.conditions_to_sell)}
          <div style={{
            padding: '10px',
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: '4px',
            marginTop: '12px'
          }}>
            {fieldDisplay('Why I Might Be Wrong', entry.before_buying.why_i_might_be_wrong)}
            {fieldDisplay('Bear Case', entry.before_buying.bear_case)}
          </div>
          {fieldDisplay('Confidence', `${entry.before_buying.confidence}/10`)}
          {fieldDisplay('Emotional State', entry.before_buying.emotional_state)}
          <div style={{ marginTop: '12px', fontSize: '12px', color: colors.muted }}>
            <strong>Checklist:</strong>
            <div style={{ marginTop: '6px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
              {Object.entries(entry.before_buying.checklist).map(([key, value]) => (
                <div key={key} style={{ fontSize: '11px' }}>
                  {value ? '✓' : '○'} {key.replace(/_/g, ' ')}
                </div>
              ))}
            </div>
          </div>
        </TimelineItem>

        {/* Holding Reviews */}
        {entry.holding_reviews.map((review, idx) => (
          <TimelineItem
            key={review.id}
            date={review.date}
            label={`Holding Review #${idx + 1}`}
          >
            {fieldDisplay('Reason', review.reason)}
            {fieldDisplay('Thesis Changed', review.thesis_changed)}
            {fieldDisplay('Action', review.action)}
            {fieldDisplay('Confidence', `${review.confidence}/10`)}
            {fieldDisplay('Notes', review.notes)}
          </TimelineItem>
        ))}

        {/* Add Holding Review Button */}
        {entry.status === 'owned' && (
          <button
            onClick={() => setShowReviewForm(true)}
            style={{
              width: '100%',
              padding: '12px',
              marginBottom: '16px',
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              color: colors.text,
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            <Plus size={16} /> Add Holding Review
          </button>
        )}

        {/* After Selling */}
        {entry.status === 'sold' && entry.after_selling.date_sold && (
          <TimelineItem
            date={entry.after_selling.date_sold}
            label="After Selling"
          >
            {fieldDisplay('Why I Sold', entry.after_selling.why_sold)}
            {fieldDisplay('Did My Thesis Fail', entry.after_selling.thesis_failed)}
            {fieldDisplay('Emotions Influenced This', entry.after_selling.emotions_influenced)}
            {fieldDisplay('Would Buy Again Today', entry.after_selling.would_buy_again)}
            {fieldDisplay('What I Learned', entry.after_selling.what_learned)}
          </TimelineItem>
        )}

        {/* Mark as Sold Button */}
        {entry.status === 'owned' && (
          <button
            onClick={() => setShowSoldForm(true)}
            style={{
              width: '100%',
              padding: '12px',
              marginBottom: '16px',
              backgroundColor: colors.red,
              color: colors.bg,
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Mark as Sold
          </button>
        )}

        {/* 90 Day Review */}
        {entry.review_90day.completed && (
          <TimelineItem
            date={new Date().toISOString().split('T')[0]}
            label="90 Day Review"
          >
            {fieldDisplay('Was My Thesis Correct', entry.review_90day.thesis_correct)}
            {fieldDisplay('Company Better Than Expected', entry.review_90day.company_better_than_expected)}
            {fieldDisplay('Did I Sell Too Early', entry.review_90day.sold_too_early)}
            {fieldDisplay('Would Make Same Decision', entry.review_90day.same_decision_again)}
            {fieldDisplay('Process Score', `${entry.review_90day.process_score}/10`)}
          </TimelineItem>
        )}

        {/* 90 Day Review Button */}
        {entry.status === 'sold' && !entry.review_90day.completed && (
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
            padding: '20px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: colors.text }}>
              Add Holding Review
            </h2>
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

            <div style={{ display: 'flex', gap: '8px' }}>
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
            padding: '20px',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <h2 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px', color: colors.text }}>
              Mark as Sold
            </h2>
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

            <div style={{ marginBottom: '16px' }}>
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

            <div style={{ display: 'flex', gap: '8px' }}>
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
    </div>
  );
}
