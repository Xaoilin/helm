import type { Task, CalendarEvent, Surface } from '../../types/domain';

export interface AgendaItem {
  id: string;
  time: string;
  title: string;
  type: 'event' | 'task';
  meta?: string;
  task?: Task;
  sourceId?: string;
  passed?: boolean;
}

interface AgendaListProps {
  agenda: AgendaItem[];
  todayEvents: CalendarEvent[];
  todayStr: string;
  getEventPalette: (sourceId: string) => { bg: string; border: string } | null;
  onNavigate: (surface: Surface) => void;
  onCompleteTask: (task: Task) => void;
}

export default function AgendaList({
  agenda,
  todayEvents,
  todayStr: _todayStr,
  getEventPalette,
  onNavigate,
  onCompleteTask,
}: AgendaListProps) {
  return (
    <div className="dash-card">
      <div className="dash-card-header">
        <span>Today's Agenda</span>
        <span style={{ fontSize: 11, color: '#6b6f85' }}>{todayEvents.length} event{todayEvents.length !== 1 ? 's' : ''}</span>
      </div>
      {agenda.length === 0 ? (
        <div style={{ padding: '16px 0', color: '#6b6f85', fontSize: 13, textAlign: 'center' }}>No events or tasks today</div>
      ) : (
        <div className="dash-agenda">
          {agenda.map(item => {
            const pal = item.sourceId ? getEventPalette(item.sourceId) : null;
            return (
              <div key={item.id} className={`dash-agenda-item ${item.type} ${item.passed ? 'passed' : ''}`} style={pal ? { borderLeft: `3px solid ${item.passed ? '#2a2d42' : pal.border}`, background: item.passed ? undefined : pal.bg, borderRadius: 4, paddingLeft: 10 } : {}}>
                <div className="dash-agenda-time">{item.time}</div>
                <div className="dash-agenda-content">
                  <div className="dash-agenda-title">{item.title}</div>
                  {item.meta && <span className={`tag ${item.type === 'task' ? `tag-${item.meta}` : ''}`} style={item.type === 'event' ? { background: '#1e2030', color: '#9499b0', fontSize: 10, padding: '1px 6px' } : {}}>{item.meta}</span>}
                </div>
                {item.task && !item.task.completed && (
                  <button className="btn btn-primary btn-sm" onClick={() => onCompleteTask(item.task!)}>Done</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <button className="dash-card-link" onClick={() => onNavigate('calendar')}>See full calendar &rarr;</button>
    </div>
  );
}
