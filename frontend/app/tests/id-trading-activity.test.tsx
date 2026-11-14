import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { WalletActivity } from '@dya/wallet-ui/components/wallet-activity';
import { useTradingWallet } from '../../id/components/use-trading-wallet';
import { readTradingActivity } from '../../../packages/wallet-ui/src/lib/near/http/trading-wallet-client';

vi.mock('../../../packages/wallet-ui/src/lib/near/http/trading-wallet-client', () => ({
  readTradingActivity: vi.fn(),
  readTradingTokenBalances: async () => ({ balances: [] }),
}));
afterEach(cleanup);

function TradingActivity({ id }: { id: string }) {
  const wallet = useTradingWallet(id, []);
  return <WalletActivity accountId={id} source={wallet.activity} />;
}

test('switching Trading accounts replaces the selected wallet’s activity', async () => {
  vi.mocked(readTradingActivity).mockImplementation(async id => ({
    requests: [{ request_id: id, type: id === 'first' ? 'deposit' : 'swap', status: 'success', created_at: '2026-11-14T10:00:00Z' }],
  }));
  const client = new QueryClient();
  const dashboard = (id: string) => (
    <QueryClientProvider client={client}>
      <TradingActivity id={id} />
    </QueryClientProvider>
  );
  const { rerender } = render(dashboard('first'));
  expect(await screen.findByText('Deposit')).toBeInTheDocument();
  rerender(dashboard('second'));
  expect(screen.queryByText('Deposit')).not.toBeInTheDocument();
  expect(await screen.findByText('Swap')).toBeInTheDocument();
  expect(readTradingActivity).toHaveBeenCalledWith('second');
});
