# Habit Tracker Gamification Plan

## Overview

Transform the Habit Tracker into a terminal-style gamified experience. The core metaphor: **you are a system operator maintaining uptime on critical processes (habits)**.

---

## Phase 1: XP & Level System

### Data Model Changes

```typescript
interface HabitState {
  // Existing
  habits: Habit[];
  completions: HabitCompletion[];

  // New - Gamification
  xp: number;
  level: number;
  totalXpEarned: number;  // Lifetime XP (for stats)
}
```

### XP Mechanics

| Action | XP Earned |
|--------|-----------|
| Complete a habit | +10 XP |
| Complete all habits for the day | +25 XP bonus |
| Maintain streak (per day) | +5 XP × streak multiplier |
| First completion of the day | +5 XP bonus |

**Streak Multiplier:**
- Days 1-7: 1x
- Days 8-14: 1.5x
- Days 15-30: 2x
- Days 31+: 3x

### Level Progression

| Level | XP Required | Rank Title |
|-------|-------------|------------|
| 1 | 0 | GUEST |
| 2 | 100 | USER |
| 3 | 250 | MEMBER |
| 4 | 500 | OPERATOR |
| 5 | 1,000 | TECHNICIAN |
| 6 | 2,000 | ENGINEER |
| 7 | 3,500 | SYSADMIN |
| 8 | 5,500 | ARCHITECT |
| 9 | 8,000 | ROOT |
| 10 | 12,000 | KERNEL |

XP formula: `xpForLevel(n) = 100 * (n-1) + 50 * (n-1)^2` (roughly)

### UI - Stats Header

```
┌─────────────────────────────────────────┐
│ LVL 7 SYSADMIN    XP: 3,842/5,500       │
│ [████████████░░░░░░░░] 70%              │
│ UPTIME: 15d        BEST: 23d            │
└─────────────────────────────────────────┘
```

Compact version for smaller panels:
```
LVL 7 SYSADMIN • 3,842 XP • UPTIME: 15d
```

---

## Phase 2: Enhanced Streaks ("Uptime")

### Terminology

| Standard Term | Terminal Term |
|---------------|---------------|
| Streak | UPTIME |
| Streak broken | KERNEL PANIC |
| Best streak | RECORD UPTIME |
| Streak freeze | CHECKPOINT |
| Perfect day | ALL SYSTEMS NOMINAL |

### Streak Features

1. **Current Uptime** - Days in a row with at least 1 habit completed
2. **Perfect Uptime** - Days in a row with ALL habits completed
3. **Record Uptime** - Personal best streak
4. **Checkpoints** - Allow 1 skip per week without breaking streak (earned at certain levels)

### Data Model

```typescript
interface HabitState {
  // ... existing

  // Streaks
  currentStreak: number;
  bestStreak: number;
  perfectStreak: number;      // All habits completed
  bestPerfectStreak: number;
  checkpointsAvailable: number;  // Streak freezes
  lastCheckpointUsed?: string;   // Date string
}
```

### Streak Break Feedback

When streak breaks, show dramatic terminal message:
```
╔════════════════════════════════════════╗
║  ⚠ KERNEL PANIC - UPTIME RESET ⚠       ║
║                                        ║
║  Previous uptime: 15 days              ║
║  System rebooting...                   ║
║                                        ║
║  > Press any key to continue_          ║
╚════════════════════════════════════════╝
```

---

## Phase 3: Heat Map Calendar

### Design

GitHub-style contribution graph showing completion density:

```
         JAN 2026
    Su Mo Tu We Th Fr Sa
              1  2  3  4
    ░░ ░░ ░░ ▓▓ ██ ██ ▓▓
     5  6  7  8  9 10 11
    ██ ██ ▓▓ ░░ ██ ██ ██
    12 13 14 15 16 17 18
    ██ ▓▓ ██ ██ ░░ ░░ ▓▓
```

### Density Levels

| Symbol | Meaning | Color |
|--------|---------|-------|
| `░░` | 0% complete | #222 (dark) |
| `▒▒` | 1-33% complete | #004444 |
| `▓▓` | 34-66% complete | #006666 |
| `██` | 67-99% complete | #00aaaa |
| `██` | 100% complete | #00ffff (bright) |

### Toggle View

Add a button/tab to switch between:
- **LIST VIEW** - Current habit checklist
- **CALENDAR VIEW** - Heat map

---

## Phase 4: Achievements System

### Data Model

```typescript
interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;        // ASCII character
  unlockedAt?: number; // Timestamp when unlocked
  category: 'streak' | 'completion' | 'level' | 'special';
}

interface HabitState {
  // ... existing
  achievements: string[];  // Array of unlocked achievement IDs
}
```

### Achievement List

#### Streak Achievements
| ID | Name | Description | Requirement |
|----|------|-------------|-------------|
| `first_boot` | FIRST_BOOT | Complete your first habit | 1 completion |
| `week_uptime` | WEEK_UPTIME | Maintain 7-day streak | 7d streak |
| `month_uptime` | MONTH_UPTIME | Maintain 30-day streak | 30d streak |
| `quarter_uptime` | QUARTER_UPTIME | Maintain 90-day streak | 90d streak |
| `year_uptime` | YEAR_UPTIME | Maintain 365-day streak | 365d streak |

#### Completion Achievements
| ID | Name | Description | Requirement |
|----|------|-------------|-------------|
| `all_systems_go` | ALL_SYSTEMS_GO | Complete all habits in a day | 1 perfect day |
| `perfect_week` | PERFECT_WEEK | 7 perfect days in a row | 7 perfect days |
| `centurion` | CENTURION | Complete 100 total habits | 100 completions |
| `millennium` | MILLENNIUM | Complete 1000 total habits | 1000 completions |

#### Level Achievements
| ID | Name | Description | Requirement |
|----|------|-------------|-------------|
| `operator` | OPERATOR_STATUS | Reach level 4 | Level 4 |
| `sysadmin` | SYSADMIN_STATUS | Reach level 7 | Level 7 |
| `root_access` | ROOT_ACCESS | Reach level 9 | Level 9 |
| `kernel_mode` | KERNEL_MODE | Reach level 10 | Level 10 |

#### Special Achievements
| ID | Name | Description | Requirement |
|----|------|-------------|-------------|
| `early_bird` | EARLY_BIRD | Complete all habits before 9am | Once |
| `night_owl` | NIGHT_OWL | Complete habits after 11pm | Once |
| `comeback_kid` | COMEBACK_KID | Return after 7+ day break | Special |
| `overclocked` | OVERCLOCKED | Earn 500+ XP in one day | Special |

### Achievement Unlock UI

When achievement unlocks, show toast/notification:
```
╔══════════════════════════════════════╗
║  ★ ACHIEVEMENT UNLOCKED ★            ║
║                                      ║
║  [■] WEEK_UPTIME                     ║
║  "Maintain 7-day streak"             ║
║                                      ║
║  +50 XP BONUS                        ║
╚══════════════════════════════════════╝
```

### Achievements Panel

Viewable in settings or dedicated tab:
```
┌─ ACHIEVEMENTS ─────────────────────────┐
│ UNLOCKED: 8/20                         │
│                                        │
│ [■] FIRST_BOOT      [■] WEEK_UPTIME    │
│ [■] OPERATOR_STATUS [■] ALL_SYSTEMS_GO │
│ [■] CENTURION       [■] EARLY_BIRD     │
│ [ ] MONTH_UPTIME    [ ] SYSADMIN_STATUS│
│ [ ] ROOT_ACCESS     [ ] PERFECT_WEEK   │
└────────────────────────────────────────┘
```

---

## Phase 5: Weekly Stats Panel

### Design

```
┌─ WEEKLY DIAGNOSTICS ───────────────────┐
│ WEEK OF JAN 6, 2026                    │
│                                        │
│ COMPLETION RATE:  87% ████████▓░       │
│ HABITS LOGGED:    42                   │
│ XP EARNED:        +685                 │
│ PERFECT DAYS:     4/7                  │
│                                        │
│ TOP HABIT:        Medication (100%)    │
│ NEEDS ATTENTION:  Gym (43%)            │
│                                        │
│ Mo Tu We Th Fr Sa Su                   │
│ ██ ██ ▓▓ ██ ░░ ██ ██                   │
└────────────────────────────────────────┘
```

---

## Implementation Priority

### Must Have (Phase 1)
- [ ] XP system with earning on completion
- [ ] Level progression with ranks
- [ ] Stats header showing level/XP/uptime
- [ ] XP animation on completion (+10 XP floating text)

### Should Have (Phase 2)
- [ ] Enhanced streak tracking (current + best)
- [ ] Streak multiplier for XP
- [ ] "Kernel panic" message on streak break
- [ ] Checkpoint system (streak freeze)

### Nice to Have (Phase 3-5)
- [ ] Heat map calendar view
- [ ] Achievement system
- [ ] Weekly stats panel
- [ ] Achievement unlock notifications

---

## Technical Notes

### State Migration

Existing users will need state migration:
```typescript
// Migration function
function migrateHabitState(oldState: OldHabitState): HabitState {
  return {
    ...oldState,
    xp: 0,
    level: 1,
    totalXpEarned: 0,
    currentStreak: calculateStreak(oldState.completions),
    bestStreak: calculateStreak(oldState.completions),
    achievements: [],
  };
}
```

### XP Calculation on Completion

```typescript
function calculateXpGain(habit: Habit, state: HabitState): number {
  let xp = 10; // Base XP

  // Streak multiplier
  const multiplier = getStreakMultiplier(state.currentStreak);
  xp = Math.floor(xp * multiplier);

  // First of day bonus
  if (isFirstCompletionToday(state)) {
    xp += 5;
  }

  // All habits complete bonus
  if (willCompleteAllHabits(state)) {
    xp += 25;
  }

  return xp;
}
```

### Performance Considerations

- Calculate streaks lazily (on demand, cached)
- Store derived stats (level, rank) to avoid recalculation
- Heat map: only render visible months

---

## Open Questions

1. Should XP decay if user is inactive? (Probably not - feels punishing)
2. Should there be a leaderboard? (Maybe later, requires backend)
3. Should achievements give XP bonuses? (Yes, adds incentive)
4. Should habits have individual difficulty/XP values? (Maybe later)
