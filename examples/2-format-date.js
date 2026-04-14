/**
 * Utility: format a date for display in the UI.
 */
function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Returns the number of days between two dates.
 */
function daysBetween(dateA, dateB) {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.abs(new Date(dateB) - new Date(dateA));
  return Math.floor(diff / msPerDay);
}

module.exports = { formatDate, daysBetween };
