const PREDICTION_DEADLINE = new Date('2026-06-11T18:00:00Z'); // 1h antes do 1º jogo

function isPredictionLocked() {
  return Date.now() > PREDICTION_DEADLINE.getTime();
}

function timeUntilDeadline() {
  const diff = PREDICTION_DEADLINE.getTime() - Date.now();
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const GROUP_LABELS = {
  A:'Grupo A', B:'Grupo B', C:'Grupo C', D:'Grupo D',
  E:'Grupo E', F:'Grupo F', G:'Grupo G', H:'Grupo H',
  I:'Grupo I', J:'Grupo J', K:'Grupo K', L:'Grupo L'
};

const ALL_GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L'];
