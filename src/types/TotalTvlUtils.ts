import { TotalTvlCount, TotalTvlUtil } from '../../generated/schema';
import { Address, BigDecimal, BigInt, ethereum } from '@graphprotocol/graph-ts';
import { BI_EVERY_7_DAYS, CONST_ID } from '../utils/Constant';
import { createTvl, createTvlV2 } from './Tvl';
import { loadOrCreateVault } from './Vault';

export function pushVault(address: string, block: ethereum.Block): void {
  const vaultUtils = getTvlUtils(block);

  let array = vaultUtils.vaults
  array.push(address)
  vaultUtils.vaults = array
  vaultUtils.save()
}

export function getTvlUtils(block: ethereum.Block): TotalTvlUtil {
  let vaultUtils = TotalTvlUtil.load(CONST_ID);
  if (vaultUtils == null) {
    vaultUtils = new TotalTvlUtil(CONST_ID)
    vaultUtils.vaults = [];
    vaultUtils.lastTimestampUpdate = BigInt.zero()
    vaultUtils.timestamp = block.timestamp
    vaultUtils.createAtBlock = block.number
    vaultUtils.save()
  }

  return vaultUtils;
}

export function canCalculateTotalTvlV2(block: ethereum.Block): void {
  const tvlUtil = getTvlUtils(block);

  if (tvlUtil.lastTimestampUpdate.plus(BI_EVERY_7_DAYS).le(block.timestamp) || tvlUtil.lastTimestampUpdate.isZero()) {
    createTotalTvl(block);
  }
}

export function createTotalTvl(block: ethereum.Block): void {
  const tvlUtils = getTvlUtils(block)
  let totalTvl = BigDecimal.zero()
  const array = tvlUtils.vaults
  for (let i = 0; i < array.length; i++) {
    const tvl = loadOrCreateVault(Address.fromString(array[i]), block).tvl
    if (tvl) {
      totalTvl = totalTvl.plus(tvl)
    }
  }
  createTvlV2(totalTvl, block);
  tvlUtils.lastTimestampUpdate = block.timestamp
  tvlUtils.save()
}

export function totalTvlUp(): BigInt {
  let totalCount = TotalTvlCount.load('1')
  if (!totalCount) {
    totalCount = new TotalTvlCount('1');
    totalCount.length = BigInt.zero();
  }

  totalCount.length = totalCount.length.plus(BigInt.fromString('1'));
  totalCount.save();
  return totalCount.length;
}