import { userEvent, within } from 'storybook/test';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { WalletDashboard } from '../../../id/components/wallet-dashboard';
import { dashboardScenario } from './dashboard-api-mocks';
import { setWalletState } from './api-mocks';
import { setTransferState } from '../transfers/api-mocks';
const meta = { title: 'ID/Dashboard',component:WalletDashboard,beforeEach:()=>{setWalletState('Empty');dashboardScenario('signed-out');setTransferState(null);return ()=>{dashboardScenario(null);setTransferState(null);};} } satisfies Meta<typeof WalletDashboard>;
export default meta;
type Story = StoryObj<typeof meta>;
export const SignedOut: Story = {};
export const Funded: Story = {beforeEach:()=>dashboardScenario('funded')};
export const Locked: Story = {beforeEach:()=>dashboardScenario('locked')};
export const Unavailable: Story = {beforeEach:()=>dashboardScenario('unavailable')};

export const WithActivity: Story = { beforeEach: () => { dashboardScenario('funded'); setTransferState('Completed'); } };
export const PendingActivity: Story = { beforeEach: () => { dashboardScenario('funded'); setTransferState('Processing'); } };

export const MultiNetwork: Story = { beforeEach: () => dashboardScenario("multi-network") };
export const MultiNetworkExpanded: Story = { ...MultiNetwork, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Expand USDC networks' })); } };

export const ActivityUnavailable: Story = { beforeEach: () => dashboardScenario('activity-unavailable') };

export const PartialActivityError: Story = { beforeEach: () => { dashboardScenario("partial-activity-error"); setTransferState("Completed"); } };
