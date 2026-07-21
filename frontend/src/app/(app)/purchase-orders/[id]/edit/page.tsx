'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { api, errMsg } from '../../../../../lib/api';
import PurchaseOrderEditor from '../../../../../components/purchase-order-editor';
import { Skeleton } from '../../../../../components/ui/skeleton';

export default function EditPurchaseOrderPage() {
  const params = useParams<{ id: string }>();
  const [po, setPo] = useState<any>(null);

  useEffect(() => {
    api.get(`/purchase-orders/${params.id}`).then((r) => setPo(r.data)).catch((e) => toast.error(errMsg(e)));
  }, [params.id]);

  if (!po)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );

  return <PurchaseOrderEditor editing={po} />;
}
