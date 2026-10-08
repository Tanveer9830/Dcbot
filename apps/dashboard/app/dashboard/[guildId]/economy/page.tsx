import { loadGuildPage } from '../../../../lib/guildPage';
import { SettingsForm } from '../../../../components/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function EconomyPage({ params }: { params: { guildId: string } }): Promise<JSX.Element> {
  const context = await loadGuildPage(params.guildId);
  const config = (context.settings.economy ?? {}) as Record<string, unknown>;
  const read = <T,>(key: string, fallback: T): T => (config[key] === undefined ? fallback : (config[key] as T));

  return (
    <div>
      <h2>Economy</h2>
      <div className="alert" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        This is a virtual game currency. There is no real-money payout, no cash-out and no gambling stake anywhere in
        this system.
      </div>
      <SettingsForm
        guildId={context.guildId}
        group="economy"
        fields={[
          { key: 'enabled', label: 'Economy enabled', type: 'boolean', value: read('enabled', true) },
          { key: 'currencyName', label: 'Currency name', type: 'text', value: read('currencyName', 'coins') },
          { key: 'currencySymbol', label: 'Currency symbol', type: 'text', value: read('currencySymbol', '🪙') },
          { key: 'dailyMin', label: 'Daily minimum', type: 'number', value: read('dailyMin', 200), min: 0, max: 1000000 },
          { key: 'dailyMax', label: 'Daily maximum', type: 'number', value: read('dailyMax', 500), min: 0, max: 1000000 },
          { key: 'weeklyMin', label: 'Weekly minimum', type: 'number', value: read('weeklyMin', 1000), min: 0, max: 10000000 },
          { key: 'weeklyMax', label: 'Weekly maximum', type: 'number', value: read('weeklyMax', 2500), min: 0, max: 10000000 },
          { key: 'workMin', label: 'Work minimum', type: 'number', value: read('workMin', 100), min: 0, max: 1000000 },
          { key: 'workMax', label: 'Work maximum', type: 'number', value: read('workMax', 400), min: 0, max: 1000000 },
          { key: 'transfersEnabled', label: 'Allow transfers', type: 'boolean', value: read('transfersEnabled', true) },
          { key: 'minimumTransfer', label: 'Minimum transfer', type: 'number', value: read('minimumTransfer', 50), min: 1, max: 1000000 },
          { key: 'transferFeePercent', label: 'Transfer fee (%)', type: 'number', value: read('transferFeePercent', 0), min: 0, max: 25 },
        ]}
      />
      <p className="muted" style={{ marginTop: 10 }}>
        Balance changes run inside database transactions with row locks; transfers lock both accounts in a fixed order
        and use idempotency keys so a retried request cannot duplicate the payment.
      </p>
    </div>
  );
}
