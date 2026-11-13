import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { MessageCircle, Printer, X } from 'lucide-react';
import type { Bill, CafeSettings, KotTicket } from '../shared/types';
import { buildWhatsAppBillLink, generateUpiUri, getLineUnitPrice, round2 } from '../shared/calculations';

interface ReceiptModalProps {
  bill?: Bill | null;
  kot?: KotTicket | null;
  settings: CafeSettings;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({ bill, kot, settings, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [paperSize, setPaperSize] = useState<'58mm' | '80mm'>(settings.paperSize);
  const [waPhone, setWaPhone] = useState('');

  useEffect(() => {
    if (!bill || !settings.upiId) {
      setQrDataUrl('');
      return;
    }
    const uri = generateUpiUri({
      upiId: settings.upiId,
      cafeName: settings.cafeName,
      amount: bill.grandTotal,
      billRef: bill.billNumber,
    });
    QRCode.toDataURL(uri, { width: 160, margin: 1 })
      .then((url) => setQrDataUrl(url))
      .catch(() => setQrDataUrl(''));
  }, [bill, settings.upiId, settings.cafeName]);

  if (!bill && !kot) return null;

  const widthClass = paperSize === '58mm' ? 'w-[240px] print-58mm' : 'w-[320px] print-80mm';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 no-print">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-slate-900">
              {bill ? `Receipt ${bill.billNumber}` : `KOT #${kot?.kotNumber}`}
            </h3>
            <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setPaperSize('58mm')}
                className={`px-2 py-1 text-xs font-medium rounded-md ${
                  paperSize === '58mm' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                58mm
              </button>
              <button
                type="button"
                onClick={() => setPaperSize('80mm')}
                className={`px-2 py-1 text-xs font-medium rounded-md ${
                  paperSize === '80mm' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                80mm
              </button>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close receipt preview"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 bg-slate-100 flex justify-center max-h-[65vh] overflow-y-auto">
          <div className={`print-area bg-white text-slate-950 p-4 font-mono text-xs border border-slate-200 ${widthClass}`}>
            {bill ? (
              <>
                <div className="text-center border-b border-dashed border-slate-400 pb-2.5 mb-2.5">
                  <div className="text-sm font-bold uppercase tracking-wide">{settings.cafeName}</div>
                  {settings.address && <div className="text-[11px] text-slate-700 mt-0.5">{settings.address}</div>}
                  {settings.phone && <div className="text-[11px] text-slate-700">Ph: {settings.phone}</div>}
                  {settings.gstin && <div className="text-[11px] font-semibold mt-0.5">GSTIN: {settings.gstin}</div>}
                </div>

                <div className="flex justify-between text-[11px] mb-1">
                  <span>Bill: {bill.billNumber}</span>
                  <span>{bill.orderType === 'dine_in' ? bill.tableLabel : `Token #${bill.tokenNumber}`}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-600 border-b border-dashed border-slate-400 pb-2 mb-2">
                  <span>{new Date(bill.createdAt).toLocaleString('en-IN')}</span>
                  <span>By: {bill.closedByName}</span>
                </div>

                {bill.status === 'voided' && (
                  <div className="text-center font-bold border border-red-600 text-red-700 py-1 mb-2 uppercase">
                    VOIDED BILL · {bill.voidReason}
                  </div>
                )}

                <table className="w-full text-[11px] mb-2">
                  <thead>
                    <tr className="border-b border-dashed border-slate-400 text-left">
                      <th className="py-1 font-semibold">Item</th>
                      <th className="py-1 font-semibold text-right">Qty</th>
                      <th className="py-1 font-semibold text-right">Amt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bill.items.map((it) => (
                      <tr key={it.id} className="align-top">
                        <td className="py-1 pr-1">
                          <div>{it.name}</div>
                          {it.addons.length > 0 && (
                            <div className="text-[10px] text-slate-600">
                              +{it.addons.map((a) => a.name).join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="py-1 text-right tabular-nums">{it.qty}</td>
                        <td className="py-1 text-right tabular-nums">
                          {round2(getLineUnitPrice(it) * it.qty).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="border-t border-dashed border-slate-400 pt-2 space-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{bill.subtotal.toFixed(2)}</span>
                  </div>
                  {bill.discountAmount > 0 && (
                    <div className="flex justify-between">
                      <span>Discount</span>
                      <span className="tabular-nums">-{bill.discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>CGST</span>
                    <span className="tabular-nums">{bill.cgstAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SGST</span>
                    <span className="tabular-nums">{bill.sgstAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold border-t border-dashed border-slate-400 pt-1.5 mt-1">
                    <span>GRAND TOTAL</span>
                    <span className="tabular-nums">Rs.{bill.grandTotal.toFixed(2)}</span>
                  </div>
                </div>

                <div className="border-t border-dashed border-slate-400 mt-2 pt-2 text-[11px]">
                  <div className="font-semibold">Payment:</div>
                  {bill.payments.map((p, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className="uppercase">{p.mode}</span>
                      <span className="tabular-nums">Rs.{p.amount.toFixed(2)}</span>
                    </div>
                  ))}
                  {bill.splitLabel && <div className="text-[10px] text-slate-600 mt-0.5">{bill.splitLabel}</div>}
                </div>

                {qrDataUrl && (
                  <div className="mt-3 pt-2 border-t border-dashed border-slate-400 flex flex-col items-center">
                    <img src={qrDataUrl} alt="UPI Payment QR" className="w-28 h-28" referrerPolicy="no-referrer" />
                    <div className="text-[10px] text-slate-700 mt-1">Scan to pay via UPI ({settings.upiId})</div>
                  </div>
                )}

                <div className="text-center text-[11px] text-slate-700 mt-3 pt-2 border-t border-dashed border-slate-400">
                  {settings.receiptFooter || 'Thank you for visiting!'}
                </div>
              </>
            ) : kot ? (
              <>
                <div className="text-center border-b border-dashed border-slate-400 pb-2 mb-2">
                  <div className="text-sm font-bold uppercase">KITCHEN ORDER TICKET</div>
                  <div className="text-base font-bold mt-0.5">KOT #{kot.kotNumber}</div>
                </div>
                <div className="flex justify-between text-[11px] mb-1 font-semibold">
                  <span>{kot.tableLabel}</span>
                  <span>{kot.orderType === 'dine_in' ? 'DINE-IN' : 'TAKEAWAY'}</span>
                </div>
                <div className="flex justify-between text-[11px] text-slate-600 border-b border-dashed border-slate-400 pb-2 mb-2">
                  <span>{new Date(kot.createdAt).toLocaleTimeString('en-IN')}</span>
                  <span>By: {kot.createdByName}</span>
                </div>
                <div className="space-y-2">
                  {kot.items.map((it, idx) => (
                    <div key={idx} className="border-b border-dotted border-slate-300 pb-1.5">
                      <div className="flex justify-between font-bold text-xs">
                        <span>{it.name}</span>
                        <span className="tabular-nums">x{it.qty}</span>
                      </div>
                      {it.addons.length > 0 && (
                        <div className="text-[11px] text-slate-700">+ {it.addons.join(', ')}</div>
                      )}
                      {it.notes && <div className="text-[11px] font-semibold">Note: {it.notes}</div>}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-3 no-print">
          {bill && (
            <div className="flex gap-2">
              <input
                type="tel"
                value={waPhone}
                onChange={(e) => setWaPhone(e.target.value)}
                placeholder="Customer WhatsApp (optional, e.g. 9198...)"
                aria-label="Customer WhatsApp number"
                className="flex-1 h-10 px-3 rounded-lg border border-slate-300 text-xs"
              />
              <a
                href={buildWhatsAppBillLink({ phone: waPhone, bill, settings })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 h-10 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 whitespace-nowrap shrink-0"
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp
              </a>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex-1 h-11 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Print {paperSize}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 h-11 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
