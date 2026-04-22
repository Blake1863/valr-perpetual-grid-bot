# VALR Perpetual Grid Bot

![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-brightgreen)
![License](https://img.shields.io/badge/License-MIT-blue)
![Built with OpenClaw](https://img.shields.io/badge/Built_with-OpenClaw-orange)

A production-grade perpetual futures grid trading bot for the [VALR exchange](https://valr.com). Automatically maintains a continuous grid of limit orders within a defined price range, capturing spread through repeated buy-low/sell-high execution while managing risk through stop-losses, range exits, and margin monitoring.

## What this is

Grid trading exploits mean-reverting price action within a bounded range. The bot places `N` limit orders between a lower bound (`L`) and upper bound (`U`). As price moves:

- **Price goes up**: More BUY orders below, fewer SELL orders above (dynamic inventory bias)
- **Price goes down**: More SELL orders above, fewer BUY orders below
- **Orders fill**: When a BUY fills, a SELL is placed at the next higher level; when a SELL fills, a BUY is placed at the next lower level

This creates a continuous cycle of capturing small profits from price oscillations while maintaining controlled exposure.

**What it's good for**: Range-bound markets with frequent price oscillations.

**What it's NOT good for**: Strong trending markets (will get stopped out), very low volatility (few fills).

## Quick start

1. **Clone and install**:
   ```bash
   git clone https://github.com/Blake1863/valr-perpetual-grid-bot.git
   cd valr-perpetual-grid-bot
   npm install && npm run build
   ```

2. **Configure API keys**:
   ```bash
   cp .env.example .env
   # Edit .env with your VALR API key/secret
   ```

3. **Create config**:
   ```bash
   cp configs/sol.example.json configs/sol.json
   # Edit configs/sol.json with your desired parameters
   ```

4. **Run**:
   ```bash
   npm start -- configs/sol.json
   ```

## Configuration

All configuration is in JSON files under `configs/`. Only 4 fields are truly required:

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `pair` | ✅ | - | Trading pair (e.g., "SOLUSDTPERP") |
| `subaccountId` | ✅ | - | VALR subaccount ID |
| `gridCount` | ✅ | - | Number of grid orders (2-200) |
| `lowerBound` | ✅ | - | Lower price bound |
| `upperBound` | ✅ | - | Upper price bound |
| `stopLossPercent` | ❌ | 3.0 | Stop-loss percentage from avg entry |

### Full configuration schema

```typescript
{
  // === Required user inputs ===
  "pair": string,                    // e.g. "SOLUSDTPERP"
  "subaccountId": string,            // VALR subaccount ID
  "gridCount": number,               // N — number of ORDERS (2-200)
  "lowerBound": string,              // e.g. "82.00"
  "upperBound": string,              // e.g. "92.00"
  "stopLossPercent": number,         // Default: 3.0

  // === Grid ===
  "gridMode": "geometric"|"arithmetic", // Default: "geometric"
  "referencePrice": string,          // Optional: defaults to current mark

  // === Capital ===
  "leverage": number,                // Default: 10 (1-60)
  "capitalAllocationPercent": number, // Default: 100 (1-100)
  "reservePercent": number,          // Default: 10 (0-50)
  "dynamicSizing": boolean,          // Default: true
  "quantityPerLevel": string,        // Required if dynamicSizing=false

  // === Risk ===
  "onRangeExit": "halt"|"close_and_reset", // Default: "halt"
  "stopLossReference": "avg_entry"|"disabled", // Default: "avg_entry"
  "marginRatioAlertPercent": number, // Default: 80
  "liquidationProximityPercent": number, // Default: 10
  "consecutiveFailuresThreshold": number, // Default: 20
  "consecutiveFailuresWindowSecs": number, // Default: 60
  "cooldownAfterStopSecs": number,   // Default: 300

  // === Execution ===
  "postOnly": boolean,               // Default: true
  "allowMargin": boolean,            // Default: false
  "triggerType": "MARK_PRICE"|"LAST_PRICE", // Default: "MARK_PRICE"
  "referencePriceSource": "mark_price"|"last_price", // Default: "mark_price"

  // === Tuning ===
  "reconcileIntervalSecs": number,   // Default: 10
  "staleDataTimeoutMs": number,      // Default: 30000
  "maxPlacementsPerSec": number,     // Default: 5
  "dryRun": boolean                  // Default: false
}
```

## Strategy explanation

```
CORE OBJECTIVE
Maintain a continuous grid of limit orders within a defined price range on
perpetual futures, capture spread through repeated buy-low/sell-high execution.
The system must always keep N active orders in the market.

GRID SETUP
- Lower bound L, Upper bound U, Number of grid orders N
- Spacing: geometric (default) or arithmetic
- Divide [L, U] into N+1 intervals (N+2 boundary points)
- Inner N levels are orderable; boundary levels 0 and N+1 are range limits

ORDER PLACEMENT
- At all times:
  - BUY orders at levels where price < currentPrice
  - SELL orders at levels where price > currentPrice
- Total active orders must ALWAYS = N (when capital allows)

DYNAMIC INVENTORY BIAS
- The grid must NOT remain symmetric
- Price moves up → more BUY levels below, fewer SELL levels above
- Price moves down → more SELL levels above, fewer BUY levels below
- Always maintain full coverage in [L, U]
- Sides are recomputed every tick from (level_price, current_price)

EXECUTION LOOP (on fill events)
- When BUY at level i fills → place SELL at level i+1
- When SELL at level i fills → place BUY at level i-1
- (Implementation: the next reconciliation tick handles this via plan-vs-reality
  diff — do NOT replace inline to avoid races)

CAPITAL MANAGEMENT
- Allocate capital evenly across grid levels
- Fixed order size per level (auto-computed via dynamic sizing formula in §5)
- Use leverage as configured (must match exchange-side leverage tier)
- Margin safety check before every batch placement

RISK MANAGEMENT
- Range exit: HALT (cancel all orders, pause new placements, wait for re-entry)
- Stop loss: configurable percentage from AVERAGE POSITION ENTRY PRICE
  Default 3%. When triggered: cancel all orders, market-close position, halt.
- Monitor: margin ratio, liquidation proximity, funding rate awareness

CONSTRAINTS
- Never leave gaps in the grid
- Never exceed N active orders
- Replace filled orders (on next tick, via diff)
- Post-fill placement respects grid structure

GOAL
Exploit mean-reverting price action within a bounded range by continuously
harvesting spread while maintaining controlled inventory exposure.
```

### Grid visualization (ASCII)

```
Price
  ^
  |                          SELL
  |                       SELL
U |--------------------SELL      ← Upper bound
  |                 SELL
  |              SELL
  |           SELL
  |        SELL
  |     SELL
  |  SELL
P |← Current price (dynamic inventory bias: more SELL above, more BUY below)
  |  BUY
  |     BUY
  |        BUY
  |           BUY
  |              BUY
L |--------------------BUY      ← Lower bound
  |                 BUY
  |                       BUY
  |                          BUY
  +------------------------------------------------→
     Level 0    ...    Level N+1
     (boundary)        (boundary)
```

## Risk management

### Stop-loss
- Triggers when loss from average entry price exceeds `stopLossPercent`
- Cancels all orders, market-closes position, halts bot
- Auto-resumes after cooldown period

### Range exit
- When price exits `[L, U]`:
  - `onRangeExit: "halt"` → Cancel orders, pause, resume when back in range
  - `onRangeExit: "close_and_reset"` → Cancel orders, close position, halt

### Margin monitoring
- Alerts when margin ratio exceeds `marginRatioAlertPercent`
- Cancels all orders when close to liquidation (`liquidationProximityPercent`)

### Circuit breaker
- Halts bot after `consecutiveFailuresThreshold` failures in `consecutiveFailuresWindowSecs`
- Prevents runaway errors during exchange issues

## Running as a service

1. **Install systemd template**:
   ```bash
   ./systemd/install.sh
   ```

2. **Enable service instance**:
   ```bash
   systemctl --user enable --now valr-perpetual-grid-bot@sol.service
   ```
   (where `sol` matches `configs/sol.json`)

3. **Logs are in**:
   ```bash
   ~/.openclaw/workspace/bots/valr-perpetual-grid-bot/logs/sol.log
   ```

## Monitoring

Check current state:
```bash
npm run status -- configs/sol.json
```

Output includes:
- Bot uptime
- Active orders count
- Total realised PnL
- Recent order history

## Troubleshooting

### Insufficient balance
- Error: "Computed qty below minimum"
- Solution: Reduce `gridCount` or increase capital allocation

### Stale price data
- Warning: "Skipping reconcile due to stale price data"
- Cause: WebSocket connection issues
- Solution: Check network connectivity

### Leverage tier mismatch
- Warning: "Could not verify/set leverage"
- Solution: Manually set leverage on VALR to match config

## How to add a new pair

1. **Create config file**:
   ```bash
   cp configs/sol.example.json configs/newpair.json
   # Edit with new pair parameters
   ```

2. **Set leverage tier on VALR**:
   - Go to VALR futures trading page
   - Set leverage to match your config

3. **Verify pair constraints**:
   - The bot will auto-fetch constraints on first run
   - Or add to `src/exchange/pairMetadata.ts` static constraints

4. **Start service**:
   ```bash
   systemctl --user enable --now valr-perpetual-grid-bot@newpair.service
   ```

## Architecture

```
valr-perpetual-grid-bot/
├── src/
│   ├── app/               # Orchestrator and supervisor
│   ├── config/            # Configuration loading and validation
│   ├── exchange/          # VALR API clients (REST + WebSocket)
│   ├── strategy/          # Pure business logic (grid, planning, reconciliation)
│   ├── state/             # SQLite persistence layer
│   └── alerts/            # Notification system
├── configs/               # Bot configuration files
├── scripts/               # CLI utilities (dry-run, status, reset)
├── systemd/               # Service templates
├── logs/                  # Runtime logs and SQLite databases (gitignored)
└── dist/                  # Compiled output (gitignored)
```

## Development

### npm scripts
- `npm run build` - Compile TypeScript to `dist/`
- `npm run typecheck` - Type check without emitting
- `npm test` - Run unit tests
- `npm run dry-run -- configs/sol.json` - Test grid generation
- `npm run status -- configs/sol.json` - Show current state
- `npm run reset -- configs/sol.json` - Cancel orders and wipe state

### Testing
Unit tests cover pure functions:
- `buildLevels` - Grid construction
- `planDesiredOrders` - Order planning with dynamic bias
- `reconcile` - Diff algorithm
- `computeQuantityPerLevel` - Capital allocation
- Stop-loss trigger logic

### Contributing
1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure `npm run typecheck` and `npm test` pass
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

Originally commissioned for VALR perpetual futures trading. Built with [OpenClaw](https://openclaw.com).
