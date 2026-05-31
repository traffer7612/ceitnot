import { BaseError, decodeErrorResult, type Abi } from 'viem';

/**
 * Best-effort message for failed wallet writes: viem shortMessage + optional ABI decode.
 */
export function formatWriteContractError(err: unknown, abi?: Abi): string {
  if (err instanceof BaseError) {
    let data: `0x${string}` | undefined;
    err.walk((e) => {
      const d = (e as { data?: unknown }).data;
      if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) {
        data = d as `0x${string}`;
        return false;
      }
      return true;
    });
    if (data && abi?.length) {
      try {
        const { errorName, args } = decodeErrorResult({ abi, data });
        const argStr = args && args.length ? ` ${JSON.stringify(args)}` : '';
        return `${errorName}${argStr}`;
      } catch {
        /* fall through */
      }
    }
    const detail = err.details ? ` — ${err.details}` : '';
    return `${err.shortMessage}${detail}`.slice(0, 400);
  }
  if (err instanceof Error) return err.message.split('\n')[0].slice(0, 400);
  return String(err).slice(0, 400);
}

/** Short user hint for known Ceitnot engine custom errors (RU). */
export function hintForEngineError(decodedLine: string): string | undefined {
  const lower = decodedLine.toLowerCase();
  if (decodedLine.includes('Ceitnot__SameBlockInteraction') || lower.includes('0x416d8cff'))
    return 'В одном блоке по этому рынку уже была операция. Подождите следующий блок или отправьте одну транзакцию.';
  if (decodedLine.includes('Ceitnot__HealthFactorBelowOne') || lower.includes('0x9e0636a3'))
    return 'После такого withdraw health factor будет ниже 1.0. Сначала погасите часть долга или выводите меньше collateral.';
  if (decodedLine.includes('Ceitnot__InsufficientCollateral') || lower.includes('0xc1c71392'))
    return 'Сумма вывода больше, чем collateral shares в позиции.';
  if (decodedLine.includes('Ceitnot__ExceedsLTV') || lower.includes('0x7e188118'))
    return 'Сумма borrow превышает LTV лимит рынка. Уменьшите сумму или увеличьте collateral.';
  if (decodedLine.includes('Ceitnot__IsolationViolation') || lower.includes('0x8f0293e9'))
    return 'Режим изоляции: нельзя иметь залог/долг на другом рынке одновременно с этим.';
  if (
    decodedLine.includes('CeitnotUSD__InsufficientAllowance')
    || lower.includes('0xf4d0de6c')
  )
    return 'Недостаточно allowance на ceitUSD для контракта (Engine при Repay или PSM при swap ceitUSD→USDC). Нажмите Approve ещё раз; в кошельке лучше unlimited, не точную сумму. Если меняли сумму после approve — approve заново.';
  if (decodedLine.includes('Ceitnot__InvalidParams') || lower.includes('0x10867118'))
    return 'Часто не хватает approve на Engine для vault shares, или vault не принял transferFrom.';
  if (decodedLine.includes('Ceitnot__MarketFrozen')) return 'Рынок заморожен (frozen).';
  if (decodedLine.includes('Ceitnot__MarketInactive')) return 'Рынок выключен (inactive).';
  if (decodedLine.includes('Ceitnot__Paused')) return 'Движок на паузе.';
  if (decodedLine.includes('Ceitnot__EmergencyShutdown')) return 'Включён emergency shutdown.';
  if (decodedLine.includes('Ceitnot__SupplyCapExceeded')) return 'Достигнут supply cap рынка.';
  if (decodedLine.includes('Ceitnot__ZeroAmount')) return 'Сумма 0 — введите положительное количество shares.';
  return undefined;
}
