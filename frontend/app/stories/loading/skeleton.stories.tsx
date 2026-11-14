import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Skeleton } from "@dya/ui/components/skeleton";
import { Button } from "@dya/ui/components/button";
import { Card, CardContent } from "@dya/ui/components/card";
import { FormattedNumber } from "@dya/ui/components/formatted-number";

function MeasuredPreview() {
  const [loading, setLoading] = useState(true);
  return <div className="max-w-md space-y-4 p-6">
    <Button variant="outline" onClick={() => setLoading(value => !value)}>{loading ? "Show data" : "Replay loading"}</Button>
    <Card><CardContent className="space-y-2"><p className="text-muted-foreground">Total balance</p><Skeleton loading={loading} label="Loading balance"><p className="text-4xl font-semibold"><FormattedNumber value="1250.50" format="currency" /></p></Skeleton></CardContent></Card>
  </div>;
}
const meta = { title: "Shared/Loading skeletons", component: MeasuredPreview } satisfies Meta<typeof MeasuredPreview>;
export default meta;
export const MeasuredContent: StoryObj<typeof meta> = {};
