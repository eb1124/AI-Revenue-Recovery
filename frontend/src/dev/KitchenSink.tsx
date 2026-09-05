import { useEffect, useState, type ReactNode } from 'react'
import { Badge, Card, DataTable, type DataTableColumn, EmptyState, ErrorState, Eyebrow, Metric, Money, Rule, StatusDot } from '../components/primitives'
import { HoldLedger, type HeldEntry } from '../components/floor/HoldLedger'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Eyebrow as="div">{title}</Eyebrow>
      <Rule />
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-6">{children}</div>
}

function Swatch({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-sans text-[11px] text-faint">{label}</span>
      {children}
    </div>
  )
}

interface DemoRow {
  id: string
  customer: string
  cause: string
  amountPaise: number
}

const demoRows: DemoRow[] = [
  { id: 'evt_001', customer: 'Meera Raghavan', cause: 'upi_timeout', amountPaise: 340000 },
  { id: 'evt_002', customer: 'Rohit Menon', cause: 'do_not_honour', amountPaise: 118000 },
  { id: 'evt_003', customer: 'Priya Subramaniam', cause: 'expired_card', amountPaise: 224000 },
]

const demoColumns: DataTableColumn<DemoRow>[] = [
  { key: 'customer', header: 'Customer', render: (r) => r.customer },
  { key: 'cause', header: 'Cause', render: (r) => <Badge tone="warn">{r.cause}</Badge> },
  { key: 'amount', header: 'Value at risk', numeric: true, render: (r) => <Money paise={r.amountPaise} /> },
]

// Section 10.6's own mockup examples, extended to fill the strip enough to
// show the bottom-edge mask fading real content (not just empty space).
const HOLD_LEDGER_ENTRIES: HeldEntry[] = [
  { id: '1', time: '14:34', customerName: 'Kavya Iyer', amountPaise: 27500 },
  { id: '2', time: '14:33', customerName: 'Rohan Deshpande', amountPaise: 61200 },
  { id: '3', time: '14:32', customerName: 'Meera Raghavan', amountPaise: 34000 },
  { id: '4', time: '14:32', customerName: 'Arjun Kapoor', amountPaise: 12800 },
  { id: '5', time: '14:31', customerName: 'Sana Mehta', amountPaise: 89000 },
  { id: '6', time: '14:31', customerName: 'Vikram Patel', amountPaise: 21000 },
  { id: '7', time: '14:30', customerName: 'Nisha Reddy', amountPaise: 45500 },
  { id: '8', time: '14:29', customerName: 'Aditya Verma', amountPaise: 16700 },
  { id: '9', time: '14:29', customerName: 'Priya Nair', amountPaise: 52300 },
  { id: '10', time: '14:28', customerName: 'Karthik Subramaniam', amountPaise: 9800 },
  { id: '11', time: '14:27', customerName: 'Ishita Bose', amountPaise: 64100 },
  { id: '12', time: '14:26', customerName: 'Farhan Sheikh', amountPaise: 31900 },
  { id: '13', time: '14:25', customerName: 'Ananya Chatterjee', amountPaise: 77200 },
  { id: '14', time: '14:24', customerName: 'Dhruv Malhotra', amountPaise: 18600 },
]

/** Demonstrates the 400ms tick: starts below target, bumps up shortly after mount. */
function HoldLedgerTickDemo() {
  // ₹21,78,900 -> ₹22,10,400 (paise, not rupees — matches section 10.6's mockup total exactly).
  const [total, setTotal] = useState(217_890_000)
  useEffect(() => {
    const timer = setTimeout(() => setTotal(221_040_000), 700)
    return () => clearTimeout(timer)
  }, [])
  return <HoldLedger marginProtectedPaise={total} holdCount={394} entries={HOLD_LEDGER_ENTRIES} className="border-r border-rule" />
}

/** /kitchen-sink — every primitive, every variant, one page. Dev-only (see router.tsx). */
export function KitchenSink() {
  return (
    <div className="min-h-screen bg-paper px-8 py-10 font-sans text-ink">
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-[20px] font-medium">Kitchen sink</h1>
          <p className="text-[13px] text-muted">Every primitive, every variant. src/components/primitives/</p>
        </header>

        <Section title="Money">
          <Row>
            <Swatch label="xs (11px)">
              <Money paise={340000} size="xs" />
            </Swatch>
            <Swatch label="sm (13px)">
              <Money paise={340000} size="sm" />
            </Swatch>
            <Swatch label="md (15px)">
              <Money paise={340000} size="md" />
            </Swatch>
            <Swatch label="lg (20px)">
              <Money paise={340000} size="lg" />
            </Swatch>
            <Swatch label="xl (32px)">
              <Money paise={340000} size="xl" />
            </Swatch>
            <Swatch label="display (48px)">
              <Money paise={5117430} size="display" />
            </Swatch>
          </Row>
          <Row>
            <Swatch label="signed, positive">
              <Money paise={2210400} size="lg" signed />
            </Swatch>
            <Swatch label="signed, negative">
              <Money paise={-430000} size="lg" signed />
            </Swatch>
            <Swatch label="signed, zero">
              <Money paise={0} size="lg" signed />
            </Swatch>
            <Swatch label="compact">
              <Money paise={22104000} size="lg" compact />
            </Swatch>
            <Swatch label="compact, negative signed">
              <Money paise={-5117430} size="lg" compact signed />
            </Swatch>
          </Row>
        </Section>

        <Section title="Metric">
          <Row>
            <Metric label="Net profit" value={<Money paise={5117430} size="lg" />} />
            <Metric label="Margin protected" value={<Money paise={2210400} size="lg" />} delta={{ text: '394 holds', tone: 'muted' }} />
            <Metric
              label="Net profit vs baseline"
              value={<Money paise={5117430} size="lg" />}
              delta={{ text: '+56.3% vs baseline', tone: 'gain' }}
            />
            <Metric label="Recovery rate" value="42.9%" delta={{ text: '−1.8pts vs baseline', tone: 'muted' }} size="md" />
            <Metric label="Opt-outs caused" value="11" delta={{ text: '−29 vs baseline', tone: 'burn' }} size="md" />
          </Row>
        </Section>

        <Section title="Eyebrow">
          <Row>
            <Eyebrow>Detected</Eyebrow>
            <Eyebrow>Margin protected</Eyebrow>
            <Eyebrow>Decision stage</Eyebrow>
          </Row>
        </Section>

        <Section title="Rule">
          <div className="flex flex-col gap-2">
            <span className="font-sans text-[11px] text-faint">horizontal</span>
            <Rule />
          </div>
          <div className="flex h-8 items-stretch gap-4">
            <span className="font-sans text-[11px] text-faint">vertical</span>
            <Rule orientation="vertical" />
            <span className="font-sans text-[13px] text-muted">content on either side</span>
          </div>
        </Section>

        <Section title="Badge">
          <Row>
            <Badge tone="default">default</Badge>
            <Badge tone="muted">muted</Badge>
            <Badge tone="warn">watch</Badge>
            <Badge tone="gain">recovered</Badge>
            <Badge tone="burn">lost</Badge>
            <Badge tone="hold">hold</Badge>
          </Row>
        </Section>

        <Section title="Card">
          <Row>
            <Card className="w-64">
              <p className="text-[13px] text-ink">Padded (default)</p>
              <p className="text-[13px] text-muted">16px padding, hairline border, 4px radius.</p>
            </Card>
            <Card padded={false} className="w-64">
              <p className="p-2 text-[13px] text-ink">Unpadded</p>
              <Rule />
              <p className="p-2 text-[13px] text-muted">Content controls its own spacing.</p>
            </Card>
          </Row>
        </Section>

        <Section title="StatusDot">
          <Row>
            <StatusDot tone="live" label="Running" />
            <StatusDot tone="idle" label="Idle" />
            <StatusDot tone="warn" label="Reconnecting" />
            <StatusDot tone="error" label="Disconnected" />
            <StatusDot tone="live" pulse label="Live (pulsing)" />
            <StatusDot tone="error" />
          </Row>
        </Section>

        <Section title="DataTable">
          <Card padded={false} className="overflow-hidden p-4">
            <DataTable columns={demoColumns} rows={demoRows} getRowKey={(r) => r.id} onRowClick={() => {}} />
          </Card>
          <Card padded={false} className="overflow-hidden p-4">
            <span className="mb-2 block font-sans text-[11px] text-faint">empty state</span>
            <DataTable
              columns={demoColumns}
              rows={[]}
              getRowKey={(r) => r.id}
              emptyState={<EmptyState title="No cases yet." description="Start a run from the World screen." />}
            />
          </Card>
        </Section>

        <Section title="EmptyState">
          <Card padded={false}>
            <EmptyState title="No runs yet." description="Start one from the World screen." />
          </Card>
          <Card padded={false}>
            <EmptyState
              title="No cases match these filters."
              description="Clear a filter to see more results."
              action={<Badge tone="muted">Clear filters</Badge>}
            />
          </Card>
        </Section>

        <Section title="ErrorState">
          <Card padded={false}>
            <ErrorState title="The event stream disconnected." description="Reconnecting." />
          </Card>
          <Card padded={false}>
            <ErrorState
              title="The run stopped at sim-day 12."
              description="The event stream disconnected after 5 retries."
              action={<Badge tone="burn">Retry</Badge>}
            />
          </Card>
        </Section>

        <Section title="Hold Ledger (floor component, isolated)">
          <p className="max-w-2xl font-sans text-[13px] text-muted">
            The signature element (section 10.2). 280px fixed strip. Total ticks 400ms ease-out on mount (starts below
            target, bumps up after 700ms) — indigo is the only colour used anywhere in this component.
          </p>
          <div className="h-130 w-fit overflow-hidden rounded border border-rule bg-card">
            <HoldLedgerTickDemo />
          </div>
        </Section>
      </div>
    </div>
  )
}
