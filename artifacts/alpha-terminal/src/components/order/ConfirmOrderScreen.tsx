import { useStrategy } from '@/hooks/useStrategy';
import type { CreditSpread } from '@/lib/strategyCalculator';

interface Props {
  strategy: CreditSpread;
  onConfirm: () => void;
}

export default function ConfirmOrderScreen({ strategy, onConfirm }: Props) {
  const {
    netPriceForDisplay,
    estCreditDollars,
    breakeven,
    rewardRiskRatio,
    maxRisk,
  } = useStrategy(strategy);

  return (
    <>
      <div className="net-credit-section">
        <div className="flex justify-between">
          <span className="text-gray-400">Net Credit Price</span>
          <span className="text-3xl font-mono text-green-400">
            ${netPriceForDisplay}
          </span>
        </div>

        <div className="mt-4">
          <div className="flex justify-between text-xs">
            <span>Bid {strategy.shortLeg.midPrice - 0.25}</span>
            <span className="text-yellow-400">Mid {netPriceForDisplay}</span>
            <span>Ask {strategy.shortLeg.midPrice + 0.25}</span>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div>
          <span className="text-gray-400">Est. Credit</span>
          <div className="text-2xl font-semibold text-green-400">
            ${estCreditDollars.toLocaleString()}
          </div>
        </div>
        <div>
          <span className="text-gray-400">Breakeven</span>
          <div className="text-2xl font-semibold">${breakeven}</div>
        </div>
      </div>

      <div className="mt-4 text-sm">
        R:R <span className="font-mono">{rewardRiskRatio}:1</span>
        <span className="ml-4 text-red-400">
          Max Risk ${maxRisk} {maxRisk > 750 && '(over limit)'}
        </span>
      </div>

      <button
        onClick={onConfirm}
        className="mt-8 w-full bg-green-500 py-4 text-white font-semibold rounded-xl"
      >
        Confirm Strategy
      </button>
    </>
  );
}
