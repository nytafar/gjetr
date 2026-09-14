.pragma library

// Latest only: of several requests of one kind, only the newest may apply its
// reply. `start` hands out a token and a new guard; `accepts` tells whether a
// reply carrying a token is still the newest. Used by host window focus (the
// pointer read and the focus chain), a Deck's rotation and detection.
//
// guard: { sequence }, starting at { sequence: 0 } (null counts as that).

function sequenceOf(guard) {
  return guard !== null && typeof guard === "object" && typeof guard.sequence === "number" ? guard.sequence : 0
}

// -> { guard: the new guard to keep, token: what the request carries }
function start(guard) {
  var token = sequenceOf(guard) + 1
  return { guard: { sequence: token }, token: token }
}

function accepts(guard, token) {
  return typeof token === "number" && token > 0 && sequenceOf(guard) === token
}

if (typeof module !== "undefined") {
  module.exports = {
    start: start,
    accepts: accepts
  }
}
