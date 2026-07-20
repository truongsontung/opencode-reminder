#!/usr/bin/env python3
"""OpenCode / tmux live monitor - TUI built on curses.

Shows:
  - tmux sessions (name, id, attached/state, idle, created)
  - opencode processes (pid, stat, etime)
  - event log with 5-min markers to spot freezes after SSH drop

Usage:
  python3 /home/vps2/life_monitor.py
Keys: q=quit  r=force refresh
"""
import curses
import subprocess
import time
import os
import json
import sys
import json

REFRESH = 5
MARK_INTERVAL = 300
ALERT_IDLE = 600
LOG_FILE = os.path.expanduser("~/.opencode/life_monitor.log")

_scr = None
_scr_h = 0
_scr_w = 0


def safe_addstr(y, x, text, attr=0):
    global _scr_h, _scr_w
    if _scr is None:
        return
    if y < 0 or y >= _scr_h or x < 0:
        return
    text = str(text)
    maxlen = _scr_w - x
    if maxlen < 0:
        return
    if len(text) > maxlen:
        text = text[:maxlen]
    try:
        _scr.addstr(y, x, text, attr)
    except Exception:
        pass


def write_log(line):
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return ""


def get_sessions():
    out = run(["tmux", "list-sessions", "-F",
               "#{session_name}|#{session_id}|#{session_attached}|#{session_windows}|#{session_created}|#{session_activity}"])
    now = int(time.time())
    res = []
    for line in out.splitlines():
        if not line.strip():
            continue
        p = line.split("|")
        name = p[0]
        sid = p[1]
        attached = int(p[2]) if len(p) > 2 else 0
        windows = p[3] if len(p) > 3 else "?"
        created = int(p[4]) if len(p) > 4 and p[4].isdigit() else 0
        activity = int(p[5]) if len(p) > 5 and p[5].isdigit() else 0
        idle = now - activity if activity else 0
        res.append({
            "name": name, "id": sid, "attached": attached,
            "windows": windows, "created": created, "idle": idle,
        })
    return res


def get_opencode():
    out = run(["ps", "-eo", "pid,ppid,stat,etimes,args"])
    res = []
    for line in out.splitlines()[1:]:
        if "opencode" in line:
            f = line.split(None, 4)
            if len(f) >= 5:
                pid, ppid, stat, etimes, rest = f
                res.append({
                    "pid": pid, "ppid": ppid, "stat": stat,
                    "etime": int(etimes) if etimes.isdigit() else 0,
                    "args": rest[:50],
                })
    return res


def get_session_tree():
    """Return list of sessions, each with panes and opencode procs inside.

    Uses tmux list-panes -a to map pane -> pid (the shell running there),
    then matches opencode processes to panes via ppid chain.
    """
    # pane info: session_name|window|pane|pane_pid|pane_active
    out = run(["tmux", "list-panes", "-a", "-F",
               "#{session_name}|#{window_index}|#{pane_index}|#{pane_pid}|#{pane_active}"])
    sessions = {}
    for line in out.splitlines():
        if not line.strip():
            continue
        p = line.split("|")
        sname = p[0]
        win = p[1]
        pane = p[2]
        pane_pid = int(p[3]) if len(p) > 3 and p[3].isdigit() else 0
        active = int(p[4]) if len(p) > 4 else 0
        sessions.setdefault(sname, {"panes": [], "procs": []})
        sessions[sname]["panes"].append({
            "win": win, "pane": pane, "pid": pane_pid, "active": active,
        })

    # opencode procs with their ppid
    procs = get_opencode()
    # build pid->ppid map for ancestry
    pid_ppid = {int(p["pid"]): int(p["ppid"]) for p in procs if p["pid"].isdigit() and p["ppid"].isdigit()}

    for p in procs:
        ppid = int(p["ppid"]) if p["ppid"].isdigit() else 0
        pid = int(p["pid"]) if p["pid"].isdigit() else 0
        # find which session this proc belongs to: climb ppid chain to a pane_pid
        cur = ppid
        found_session = None
        seen = set()
        while cur and cur not in seen:
            seen.add(cur)
            for sname, info in sessions.items():
                for pn in info["panes"]:
                    if pn["pid"] == cur:
                        found_session = sname
                        break
                if found_session:
                    break
            if found_session:
                break
            # climb: find parent of cur
            nxt = None
            for cp, cpp in pid_ppid.items():
                if cp == cur:
                    nxt = cpp
                    break
            cur = nxt
        if found_session:
            sessions[found_session]["procs"].append(p)
        else:
            # uncategorized: put under a virtual group
            sessions.setdefault("(other)", {"panes": [], "procs": []})
            sessions["(other)"]["procs"].append(p)
    return sessions


def fmt_dur(sec):
    if sec >= 3600:
        return f"{sec//3600}h{(sec%3600)//60}m"
    if sec >= 60:
        return f"{sec//60}m{sec%60}s"
    return f"{sec}s"


def get_reminders():
    """Đọc reminder events từ plugin opencode-reminders.
    Mỗi file <sessionID>.reminder.json chứa [ {id,label,nextAt,repeat,...} ].
    Chỉ lấy session CÓ TRONG get_live_session_ids() (đang mở thật sự)."""
    import glob as _glob
    base = os.environ.get("OPENCODE_REMINDERS_DIR") or os.path.expanduser("~/.local/share/opencode-reminders")
    live = get_live_session_ids()
    now = int(time.time() * 1000)
    groups = {}
    try:
        for f in _glob.glob(f"{base}/*.reminder.json"):
            sid = os.path.basename(f)[: -len(".reminder.json")]
            if sid not in live:
                continue  # session không mở → bỏ qua
            try:
                data = json.load(open(f))
            except Exception:
                continue
            for r in data:
                if r.get("done"):
                    continue
                nxt = r.get("nextAt", 0)
                delta = (nxt - now) / 1000
                if delta > 60:
                    due = f"in {fmt_dur(int(delta))}"
                    overdue = False
                elif delta > 0:
                    due = "due now"
                    overdue = False
                else:
                    due = f"OVERDUE {-int(delta)}s"
                    overdue = delta < -60
                label = r.get("label", "")[:38]
                last = r.get("lastRemindAt", 0)
                last_s = time.strftime("%H:%M", time.localtime(last / 1000)) if last else "-"
                item = {
                    "id": r.get("id", "?"),
                    "label": label,
                    "due": due,
                    "kind": "reminder",
                    "overdue": overdue,
                    "over_secs": -int(delta) if delta < 0 else 0,
                    "last": last_s,
                }
                groups.setdefault(sid, []).append(item)
    except Exception:
        pass
    # Merge teamwork scheduler events (agent-teamwork/scheduler/*.cal.json).
    # Mỗi file tương ứng 1 session (sessionID = tên file bỏ .cal.json).
    for ev in get_teamwork_reminders():
        sid = ev["sid"]
        nxt = ev["nextAt"]
        delta = (nxt - now) / 1000
        if delta > 60:
            due = f"in {fmt_dur(int(delta))}"
            overdue = False
        elif delta > 0:
            due = "due now"
            overdue = False
        else:
            due = f"OVERDUE {-int(delta)}s"
            overdue = delta < -60
        item = {
            "id": ev["id"],
            "label": ev["label"][:38],
            "due": due,
            "kind": "team",
            "overdue": overdue,
            "over_secs": -int(delta) if delta < 0 else 0,
            "last": ev.get("lastRemindAt_s", "-"),
        }
        groups.setdefault(sid, []).append(item)
    # sort items in each group: overdue first, then soonest
    for sid in groups:
        groups[sid].sort(key=lambda x: 0 if x["overdue"] else 1)
    return groups


def get_live_session_ids():
    """Lấy set sessionID đang mở thật sự.

    Căn cứ vào tần suất tick của teamwork scheduler: mỗi session còn mở sẽ
    tick mỗi 60s và ghi file cal.json (saveCal) dù lịch là daily 24h hay
    interval. Session đã tắt → file đứng yên. Dùng mtime < 3 phút (1 tick +
    buffer) để chỉ lấy session alive — không bỏ sót session có lịch daily,
    vì tick không phụ thuộc vào lịch. Fallback: sessionID có trong
    reminders.json (plugin reminder cũng chỉ chạy ở session alive)."""
    import glob as _glob
    now = time.time()
    live = set()
    base = os.environ.get("OPENCODE_REMINDERS_DIR") or os.path.expanduser("~/.local/share/opencode-reminders")
    for f in _glob.glob(os.path.expanduser("~/.local/share/agent-teamwork/scheduler/*.cal.json")):
        try:
            if os.path.getmtime(f) > now - 90:  # 90s = 1.5 tick
                live.add(os.path.basename(f)[: -len(".cal.json")])
        except Exception:
            pass
    # Plugin reminder: mỗi session alive ghi <sid>.reminder.json mỗi tick (60s).
    for f in _glob.glob(os.path.join(base, "*.reminder.json")):
        try:
            if os.path.getmtime(f) > now - 90:  # 90s = 1.5 tick
                live.add(os.path.basename(f)[: -len(".reminder.json")])
            else:
                pass
        except Exception:
            pass
    return live


def get_teamwork_reminders():
    """Đọc calendar events từ agent-teamwork scheduler.
    Mỗi file <sessionID>.cal.json chứa { calendar: [ {id,label,nextAt,repeat,...} ] }.
    Chỉ lấy session CÓ TRONG get_live_session_ids() (đang mở thật sự, tick
    ghi file gần đây). Session đã tắt bị lọc, tránh OVERDUE giả."""
    import glob as _glob
    base = os.path.expanduser("~/.local/share/agent-teamwork/scheduler")
    live = get_live_session_ids()
    out = []
    try:
        for f in _glob.glob(f"{base}/*.cal.json"):
            sid = os.path.basename(f)[: -len(".cal.json")]
            if sid not in live:
                continue  # session không mở → bỏ qua
            try:
                d = json.load(open(f))
            except Exception:
                continue
            for ev in d.get("calendar", []):
                nxt = ev.get("nextAt", 0)
                last = ev.get("lastRemindAt", 0)
                out.append({
                    "sid": sid,
                    "id": ev.get("id", "?"),
                    "label": ev.get("label", ""),
                    "nextAt": nxt,
                    "lastRemindAt_s": time.strftime("%H:%M", time.localtime(last / 1000)) if last else "-",
                })
    except Exception:
        pass
    return out


def get_mail_heartbeat():
    """Đọc mail heartbeat từ mail checker plugin."""
    heartbeat_file = os.path.join(
        os.environ.get("OPENCODE_MAIL_DIR") or os.path.expanduser("~/.opencode/mail-server"),
        "mail_heartbeat.json"
    )
    try:
        with open(heartbeat_file) as f:
            data = json.load(f)
        return data
    except Exception:
        return None


def main(stdscr):
    curses.curs_set(0)
    stdscr.nodelay(True)
    curses.start_color()
    curses.use_default_colors()
    curses.init_pair(1, curses.COLOR_GREEN, -1)
    curses.init_pair(2, curses.COLOR_YELLOW, -1)
    curses.init_pair(3, curses.COLOR_RED, -1)
    curses.init_pair(4, curses.COLOR_CYAN, -1)

    log = []
    log_scroll = 0
    last_mark = int(time.time())
    last_poll = 0
    prev_sessions = {}

    def add_log(msg, level="info"):
        ts = time.strftime("%H:%M:%S")
        log.append((ts, msg, level))
        if len(log) > 200:
            log.pop(0)
        write_log(f"{ts} [{level}] {msg}")

    while True:
        now = int(time.time())
        key = stdscr.getch()
        if key in (ord('q'), ord('Q')):
            break
        force = key in (ord('r'), ord('R'))

        max_scroll = max(0, len(log) - 1)
        if key == curses.KEY_UP or key == ord('k'):
            log_scroll = min(max_scroll, log_scroll + 1)
        elif key == curses.KEY_DOWN or key == ord('j'):
            log_scroll = max(0, log_scroll - 1)
        elif key == curses.KEY_PPAGE or key == ord('K'):
            log_scroll = min(max_scroll, log_scroll + 10)
        elif key == curses.KEY_NPAGE or key == ord('J'):
            log_scroll = max(0, log_scroll - 10)
        elif key == curses.KEY_HOME:
            log_scroll = max_scroll
        elif key == curses.KEY_END:
            log_scroll = 0

        if now - last_poll >= REFRESH or force:
            last_poll = now
            sessions = get_sessions()
            procs = get_opencode()

            if now - last_mark >= MARK_INTERVAL:
                last_mark = now
                add_log(f"--- MARK {time.strftime('%H:%M')} ---", "mark")
                for s in sessions:
                    st = "ATTACHED" if s["attached"] else "DETACHED"
                    add_log(f"  {s['name']} [{st}] idle={fmt_dur(s['idle'])}", "mark")
                if procs:
                    stats = ",".join(p["stat"] for p in procs)
                    add_log(f"  opencode stat={stats}", "mark")

            cur = {s["name"]: s["attached"] for s in sessions}
            for name, attached in cur.items():
                if name in prev_sessions and prev_sessions[name] != attached:
                    if attached:
                        add_log(f"[!] session '{name}' ATTACHED (client connected)", "ok")
                    else:
                        add_log(f"[!] session '{name}' DETACHED (SSH dropped?)", "warn")
            prev_sessions = cur

            for p in procs:
                if p["stat"].startswith("T"):
                    add_log(f"[!!] opencode pid {p['pid']} SUSPENDED (T) - frozen!", "err")
            for s in sessions:
                if not s["attached"] and s["idle"] > ALERT_IDLE:
                    add_log(f"[!!] '{s['name']}' detached & idle {fmt_dur(s['idle'])} - reminders frozen?", "err")

            # reminder overdue check (chỉ báo khi quá hạn thật sự >60s,
            # tránh false positive lúc đang chờ flush bơm xong).
            # Chỉ cảnh báo plugin reminder (kind != 'team') — teamwork cal
            # của session đã tắt sẽ OVERDUE giả, không báo ở đây.
            rem_groups = get_reminders()
            for _sid, ritems in rem_groups.items():
                for rm in ritems:
                    if rm["overdue"] and rm.get("kind") != "team" and not rm.get("_logged"):
                        secs = rm.get("over_secs", 0)
                        if secs > 60:
                            add_log(f"[!!] REMINDER OVERDUE: {rm['label']} ({rm['id']}) - not fired {secs}s?", "err")
                            rm["_logged"] = True

        stdscr.erase()
        h, w = stdscr.getmaxyx()
        global _scr, _scr_h, _scr_w
        _scr = stdscr
        _scr_h = h
        _scr_w = w
        now_s = time.strftime("%Y-%m-%d %H:%M:%S")

        title = f" LIFE MONITOR  |  {now_s}  |  refresh {REFRESH}s  |  q=quit r=refresh "
        safe_addstr(0, 0, title.ljust(w), curses.color_pair(4) | curses.A_REVERSE)

        row = 2
        safe_addstr(row, 0, " TMUX SESSIONS", curses.A_BOLD)
        row += 1
        safe_addstr(row, 0, f" {'NAME':<18}{'ID':<12}{'STATE':<20}{'WIN':<5}{'IDLE':<10}{'CREATED'}")
        row += 1
        for s in sessions:
            state = "ATTACHED (active)" if s["attached"] else "DETACHED (no client)"
            col = curses.color_pair(1) if s["attached"] else curses.color_pair(2)
            if not s["attached"] and s["idle"] > ALERT_IDLE:
                col = curses.color_pair(3) | curses.A_BOLD
            created = time.strftime('%H:%M:%S', time.localtime(s["created"])) if s["created"] else "?"
            safe_addstr(row, 0,
                f" {s['name']:<18}{s['id']:<12}{state:<20}{s['windows']:<5}{fmt_dur(s['idle']):<10}{created}",
                col)
            row += 1
        if not sessions:
            safe_addstr(row, 0, " (no tmux sessions)")
            row += 1

        row += 1
        safe_addstr(row, 0, " REMINDERS BY SESSION", curses.A_BOLD)
        row += 1
        groups = get_reminders()
        if not groups:
            safe_addstr(row, 0, "  (none active)")
            row += 1
        for sid, items in groups.items():
            safe_addstr(row, 0, f" [{sid}]", curses.color_pair(4) | curses.A_BOLD)
            row += 1
            for rm in items:
                if rm["overdue"] and rm.get("kind") != "team":
                    col = curses.color_pair(3) | curses.A_BOLD
                elif rm["overdue"] and rm.get("kind") == "team":
                    col = curses.color_pair(2)  # vàng: teamwork OVERDUE giả (session có thể tắt)
                else:
                    col = curses.color_pair(1)
                # gọn trong 1 dòng (vừa 80 cột): id + kind + label + due
                prefix = f"  {rm['id']} [{rm['kind']}] "
                tail = f"  {rm['due']}"
                cols = _scr_w if _scr_w > 0 else 80
                label_w = max(4, cols - len(prefix) - len(tail))
                label = rm['label'][:label_w]
                safe_addstr(row, 0, f"{prefix}{label}{tail}", col)
                row += 1

        row += 1
        safe_addstr(row, 0, " MAIL CHECKER", curses.A_BOLD)
        row += 1
        hb = get_mail_heartbeat()
        if hb:
            status = hb.get("status", "unknown")
            last_ping = hb.get("last_ping", "")
            session_id = hb.get("session_id", "")
            # Parse timestamp
            if last_ping:
                try:
                    ping_dt = time.fromisoformat(last_ping.replace("Z", "+00:00"))
                    ping_ago = int(time.time() - ping_dt.timestamp())
                    ping_str = f"{fmt_dur(ping_ago)} ago"
                except Exception:
                    ping_str = last_ping
            else:
                ping_str = "never"
            # Status color
            if status == "running":
                col = curses.color_pair(1) | curses.A_BOLD  # green
            elif status == "idle":
                col = curses.color_pair(1)  # green
            elif status == "error":
                col = curses.color_pair(3) | curses.A_BOLD  # red
            else:
                col = curses.color_pair(2)  # yellow
            safe_addstr(row, 0, f"  Status: {status}", col)
            row += 1
            safe_addstr(row, 0, f"  Last ping: {ping_str}")
            row += 1
            if session_id:
                safe_addstr(row, 0, f"  Session: {session_id[:30]}")
                row += 1
        else:
            safe_addstr(row, 0, "  (no heartbeat file)", curses.color_pair(2))
            row += 1

        row += 1
        safe_addstr(row, 0, " OPENCODE PER SESSION", curses.A_BOLD)
        row += 1
        tree = get_session_tree()
        if not tree:
            safe_addstr(row, 0, " (no tmux sessions / opencode)")
            row += 1
        for sname, info in tree.items():
            attached = any(s["name"] == sname and s["attached"] for s in sessions)
            sflag = "ATT" if attached else "DET"
            col = curses.color_pair(1) if attached else curses.color_pair(2)
            safe_addstr(row, 0, f" [{sname}] ({sflag})", col | curses.A_BOLD)
            row += 1
            safe_addstr(row, 0, f"   {'PANE':<10}{'PID':<8}STATE")
            row += 1
            if not info["panes"]:
                safe_addstr(row, 0, "   (no panes)")
                row += 1
            for pn in info["panes"]:
                safe_addstr(row, 0,
                    f"   {pn['win']}.{pn['pane']:<8}{pn['pid']:<8}{'active' if pn['active'] else 'idle'}")
                row += 1
            safe_addstr(row, 0, f"   {'PID':<8}{'PPID':<8}{'STAT':<7}{'ETIME':<10}ROLE")
            row += 1
            for p in info["procs"]:
                is_sub = int(p["ppid"]) != 0 and any(
                    int(op["pid"]) == int(p["ppid"]) for op in info["procs"])
                role = "subagent" if is_sub else "main"
                col = curses.color_pair(3) | curses.A_BOLD if p["stat"].startswith("T") else curses.color_pair(0)
                safe_addstr(row, 0,
                    f"   {p['pid']:<8}{p['ppid']:<8}{p['stat']:<7}{fmt_dur(p['etime']):<10}{role}", col)
                row += 1
            if not info["procs"]:
                safe_addstr(row, 0, "   (no opencode proc in this session)")
                row += 1
            row += 1

        row += 1
        hint = " EVENT LOG  (UP/k PGUP/K=up  DOWN/j PGDN/J=down  HOME=top END=bottom)"
        safe_addstr(row, 0, hint, curses.A_BOLD)
        row += 1
        avail = h - row - 1
        if avail > 0:
            # log_scroll: 0 = newest at bottom, increasing shows older entries
            total = len(log)
            start = max(0, total - avail - log_scroll)
            shown = log[start:start + avail]
            for ts, msg, lvl in shown:
                if lvl == "err":
                    c = curses.color_pair(3) | curses.A_BOLD
                elif lvl == "warn":
                    c = curses.color_pair(2)
                elif lvl == "ok":
                    c = curses.color_pair(1)
                elif lvl == "mark":
                    c = curses.color_pair(4)
                else:
                    c = curses.color_pair(0)
                safe_addstr(row, 0, f" {ts} {msg}"[:w-1], c)
                row += 1
            if log_scroll > 0:
                safe_addstr(row, 0, f"  [scrolled up {log_scroll}, press END for latest]", curses.color_pair(4))
                row += 1

        stdscr.refresh()
        time.sleep(0.2)


if __name__ == "__main__":
    try:
        if not sys.stdin.isatty():
            print("life_monitor.py needs a real TTY (run inside tmux).")
            sys.exit(1)
        curses.wrapper(main)
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(f"life_monitor error: {e}")
