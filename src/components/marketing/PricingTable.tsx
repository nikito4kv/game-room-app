import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/icons";
import { COMPARISON_NOW, COMPARISON_PLANNED, type ComparisonRow, type ComparisonValue } from "./plans";

function Cell({ value }: { value: ComparisonValue }) {
  if (value === "yes") {
    return (
      <>
        <Icon name="check" size={18} className="mx-auto text-ink" />
        <span className="sr-only">Есть</span>
      </>
    );
  }
  if (value === "soon") {
    return (
      <>
        <Badge variant="outline" size="sm">
          Скоро
        </Badge>
        <span className="sr-only">: планируется</span>
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true" className="mx-auto block h-px w-3 bg-line-control" />
      <span className="sr-only">Нет</span>
    </>
  );
}

function Rows({ rows }: { rows: ComparisonRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <tr key={row.label} className="border-t border-line">
          <th scope="row" className="py-3 pl-4 pr-2 text-left align-middle text-label font-normal text-ink-2 sm:text-body">
            {row.label}
          </th>
          <td className="px-1 py-3 text-center align-middle">
            <Cell value={row.free} />
          </td>
          <td className="px-1 py-3 text-center align-middle">
            <Cell value={row.pro} />
          </td>
          <td className="px-1 py-3 text-center align-middle">
            <Cell value={row.club} />
          </td>
        </tr>
      ))}
    </>
  );
}

function GroupRow({ children }: { children: string }) {
  return (
    <tr className="border-t border-line bg-wash-1">
      <th scope="colgroup" colSpan={4} className="px-4 py-2 text-left text-label font-semibold text-ink">
        {children}
      </th>
    </tr>
  );
}

/**
 * Таблица «что в каком тарифе». Первая группа строк показывает, что всё нынешнее
 * бесплатно навсегда и входит в каждый тариф; вторая — что только планируется.
 * На узком экране колонки сжимаются, горизонтальной прокрутки нет.
 */
export function PricingTable() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-raised">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">Сравнение тарифов: бесплатного, Pro для хоста и Клуба</caption>
        <thead>
          <tr>
            <th scope="col" className="w-[40%] py-3 pl-4 pr-2 text-left text-label font-medium text-ink-3 sm:w-[43%]">
              Возможность
            </th>
            <th scope="col" className="px-1 py-3 text-center text-label font-semibold text-ink">
              Бесплатно
            </th>
            <th scope="col" className="px-1 py-3 text-center text-label font-semibold text-ink">
              Pro
            </th>
            <th scope="col" className="px-1 py-3 text-center text-label font-semibold text-ink">
              Клуб
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-line">
            <th scope="row" className="py-3 pl-4 pr-2 text-left align-middle text-label font-normal text-ink-2 sm:text-body">
              Цена
            </th>
            <td className="px-1 py-3 text-center align-middle text-label font-medium text-ink tabular-nums">0 ₽</td>
            <td className="px-1 py-3 text-center align-middle text-label font-medium text-ink tabular-nums">
              249 ₽ в мес.
            </td>
            <td className="px-1 py-3 text-center align-middle text-label font-medium text-ink tabular-nums">
              от 990 ₽ в мес.
            </td>
          </tr>
          <GroupRow>Есть сейчас и бесплатно навсегда</GroupRow>
          <Rows rows={COMPARISON_NOW} />
          <GroupRow>Планируется</GroupRow>
          <Rows rows={COMPARISON_PLANNED} />
        </tbody>
      </table>
    </div>
  );
}
