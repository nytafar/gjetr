#!/bin/bash
# CPU of the running Omarchy shell (which hosts gjetr), as % of one core.
#
#   scripts/perf-sample.sh [-s seconds] [-n runs] [-w warmup] [-p pid] [-t] [-l label]
#
# Each run reads utime+stime of the process (and of each thread with -t) from
# /proc before and after `seconds`; the result is the median of `runs` runs,
# with min and max. -w waits that many seconds first, for a change to settle.
# The shell is the quickshell instance whose config is $OMARCHY_PATH/shell;
# a run whose pid changed (the shell restarted) is reported and dropped.
# -t adds the median per thread group: the GUI thread, the scene-graph render
# threads (one per window), and the rest.
set -euo pipefail

seconds=15
runs=3
warmup=0
pid=""
threads=0
label=""
while getopts "s:n:w:p:tl:h" opt; do
  case $opt in
    s) seconds=$OPTARG ;;
    n) runs=$OPTARG ;;
    w) warmup=$OPTARG ;;
    p) pid=$OPTARG ;;
    t) threads=1 ;;
    l) label=$OPTARG ;;
    *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
  esac
done

shell_pid() {
  local config="${OMARCHY_PATH:-/usr/share/omarchy}/shell" p
  for p in $(pgrep -x quickshell); do
    tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qE -- "-p $config( |$)" && { echo "$p"; return 0; }
  done
  return 1
}

[[ -n $pid ]] || pid=$(shell_pid) || { echo "no Omarchy shell running" >&2; exit 1; }
hz=$(getconf CLK_TCK)

# "<group> <ticks>" per thread; fields 14 and 15 of stat, after the comm field
# (which may hold spaces, so cut at the last ')').
thread_ticks() {
  local t comm stat group
  for t in /proc/"$pid"/task/*; do
    comm=$(cat "$t/comm" 2>/dev/null) || continue
    stat=$(cat "$t/stat" 2>/dev/null) || continue
    stat=${stat##*) }
    if [[ ${t##*/} == "$pid" ]]; then group=gui
    elif [[ $comm == QSGRenderThread ]]; then group=render
    else group=other; fi
    awk -v g="$group" '{print g, $12 + $13}' <<<"$stat"
  done
}

process_ticks() {
  local stat
  stat=$(cat /proc/"$pid"/stat) || return 1
  stat=${stat##*) }
  awk '{print $12 + $13}' <<<"$stat"
}

median() { sort -n | awk '{a[NR]=$1} END {if (NR == 0) {print "-"; exit} m = NR % 2 ? a[(NR+1)/2] : (a[NR/2] + a[NR/2+1]) / 2; printf "%.1f", m}'; }

(( warmup > 0 )) && sleep "$warmup"

totals=()
declare -A groups=([gui]="" [render]="" [other]="")
for (( i = 1; i <= runs; i++ )); do
  before=$(process_ticks)
  (( threads )) && tb=$(thread_ticks)
  sleep "$seconds"
  if [[ ! -d /proc/$pid ]]; then
    echo "run $i: shell $pid went away" >&2
    exit 1
  fi
  after=$(process_ticks)
  pct=$(awk -v a="$before" -v b="$after" -v hz="$hz" -v s="$seconds" 'BEGIN {printf "%.1f", 100 * (b - a) / hz / s}')
  totals+=("$pct")
  if (( threads )); then
    ta=$(thread_ticks)
    for g in gui render other; do
      v=$(awk -v g="$g" -v hz="$hz" -v s="$seconds" '
        FNR == NR { if ($1 == g) b += $2; next }
        { if ($1 == g) a += $2 }
        END { printf "%.1f", 100 * (a - b) / hz / s }' <(echo "$tb") <(echo "$ta"))
      groups[$g]+="$v "
    done
  fi
done

med=$(printf '%s\n' "${totals[@]}" | median)
lo=$(printf '%s\n' "${totals[@]}" | sort -n | head -1)
hi=$(printf '%s\n' "${totals[@]}" | sort -n | tail -1)
line="${label:+$label  }median ${med}%  (min $lo, max $hi; ${runs}x${seconds}s, pid $pid)"
if (( threads )); then
  for g in gui render other; do
    line+="  $g $(tr ' ' '\n' <<<"${groups[$g]}" | grep -v '^$' | median)%"
  done
fi
echo "$line"
