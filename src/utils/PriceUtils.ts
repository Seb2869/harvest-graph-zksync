import { Address, BigDecimal, BigInt, ethereum, log } from '@graphprotocol/graph-ts';
import {
  BD_18,
  BD_ONE,
  BD_TEN, BD_ZERO,
  BI_18,
  BI_TEN,
  DEFAULT_DECIMAL,
  DEFAULT_PRICE,
  getFarmToken,
  isPsAddress,
  isStableCoin, SWAP_SYNC_FACTORY,
  USDC_ZK,
  USDC_DECIMAL, WETH_ZK, VELOCORE_FACTORY, WBTC_ZK,
} from './Constant';
import { Token, Vault } from "../../generated/schema";
import { WeightedPool2TokensContract } from "../../generated/templates/VaultListener/WeightedPool2TokensContract";
import { BalancerVaultContract } from "../../generated/templates/VaultListener/BalancerVaultContract";
import { ERC20 } from "../../generated/Controller/ERC20";
import { fetchContractDecimal } from "./ERC20Utils";
import { pow, powBI } from "./MathUtils";
import {
  checkBalancer,
  isBalancer, isBtc, isCurve,
  isLpUniPair, isSyncSwap, isVelcore, isWeth,
} from './PlatformUtils';
import { PancakeFactoryContract } from '../../generated/Controller/PancakeFactoryContract';
import { PancakePairContract } from '../../generated/Controller/PancakePairContract';
import { createPriceFeed } from '../types/PriceFeed';
import { AedromeFactoryContract } from '../../generated/Controller/AedromeFactoryContract';
import { AedromePoolContract } from '../../generated/Controller/AedromePoolContract';
import { CurveVaultContract } from '../../generated/Controller/CurveVaultContract';
import { CurveMinterContract } from '../../generated/Controller/CurveMinterContract';
import { SwapSyncFactoryContract } from '../../generated/Controller/SwapSyncFactoryContract';
import { SwapSyncPoolContract } from '../../generated/Controller/SwapSyncPoolContract';
import { VelocorePoolContract } from '../../generated/Controller/VelocorePoolContract';

export function getPriceForCoin(address: Address): BigInt {
  if (isStableCoin(address.toHexString())) {
    return BI_18;
  }
  if (isBtc(address)) {
    return getPriceForCoinWithSwapSync(WBTC_ZK, USDC_ZK, SWAP_SYNC_FACTORY)
  }
  if (isWeth(address)) {
    return getPriceForCoinWithSwapSync(WETH_ZK, USDC_ZK, SWAP_SYNC_FACTORY);
  }
  let price = getPriceForCoinWithSwapSync(address, WETH_ZK, SWAP_SYNC_FACTORY)
  if (price.equals(BigInt.zero())) {
    return price;
  }

  const wethPrice = getPriceForCoinWithSwapSync(WETH_ZK, USDC_ZK, SWAP_SYNC_FACTORY)

  return toBigInt(price.times(wethPrice).divDecimal(BD_18));
}

function getPriceForCoinWithSwapSync(address: Address, stableCoin: Address, factory: Address): BigInt {
  if (isStableCoin(address.toHex())) {
    return BI_18
  }
  const uniswapFactoryContract = SwapSyncFactoryContract.bind(factory)
  const tryGetPair = uniswapFactoryContract.try_getPool(stableCoin, address)
  if (tryGetPair.reverted) {
    return DEFAULT_PRICE
  }

  const poolAddress = tryGetPair.value

  const uniswapPairContract = SwapSyncPoolContract.bind(poolAddress);
  const tryGetReserves = uniswapPairContract.try_getReserves()
  if (tryGetReserves.reverted) {
    log.log(log.Level.WARNING, `Can not get reserves for ${poolAddress.toHex()}`)

    return DEFAULT_PRICE
  }
  const reserves = tryGetReserves.value
  if (reserves.get_reserve0().isZero()) {
    return DEFAULT_PRICE;
  }

  const tryToken1 = uniswapPairContract.try_token1()
  if (tryToken1.reverted) {
    return BigInt.zero();
  }

  const decimal1 = fetchContractDecimal(address)
  const decimal2 = fetchContractDecimal(stableCoin)


  let delimiter = powBI(BI_TEN, decimal1.toI32() - decimal2.toI32() + DEFAULT_DECIMAL);

  if (decimal1.le(decimal2)) {
    delimiter = powBI(BI_TEN, decimal1.toI32() - decimal2.toI32() + DEFAULT_DECIMAL)
  }

  if (tryToken1.value.equals(stableCoin)) {
    return reserves.get_reserve1().times(delimiter).div(reserves.get_reserve0())
  }
  return reserves.get_reserve0().times(delimiter).div(reserves.get_reserve1())
}

function getPriceForCoinWithSwap(address: Address, stableCoin: Address, factory: Address): BigInt {
  if (isStableCoin(address.toHex())) {
    return BI_18
  }
  const uniswapFactoryContract = PancakeFactoryContract.bind(factory)
  const tryGetPair = uniswapFactoryContract.try_getPair(stableCoin, address)
  if (tryGetPair.reverted) {
    return DEFAULT_PRICE
  }

  const poolAddress = tryGetPair.value

  const uniswapPairContract = PancakePairContract.bind(poolAddress);
  const tryGetReserves = uniswapPairContract.try_getReserves()
  if (tryGetReserves.reverted) {
    log.log(log.Level.WARNING, `Can not get reserves for ${poolAddress.toHex()}`)

    return DEFAULT_PRICE
  }
  const reserves = tryGetReserves.value
  const decimal = fetchContractDecimal(address)

  const delimiter = powBI(BI_TEN, decimal.toI32() - USDC_DECIMAL + DEFAULT_DECIMAL)

  return reserves.get_reserve1().times(delimiter).div(reserves.get_reserve0())
}

export function getPriceByVault(vault: Vault, block: ethereum.Block): BigDecimal {

  if (isPsAddress(vault.id)) {
    const tempPrice = getPriceForCoin(getFarmToken()).divDecimal(BD_18);
    createPriceFeed(vault, tempPrice, block);
    return tempPrice;
  }

  const underlyingAddress = vault.underlying

  let price = getPriceForCoin(Address.fromString(underlyingAddress))
  if (!price.isZero()) {
    createPriceFeed(vault, price.divDecimal(BD_18), block);
    return price.divDecimal(BD_18)
  }

  const underlying = Token.load(underlyingAddress)
  if (underlying != null) {
    if (isLpUniPair(underlying.name)) {
      let tempInPrice = getPriceLpUniPair(underlying.id);
      createPriceFeed(vault, tempInPrice, block);
      return tempInPrice
    }

    if (isVelcore(underlying.name)) {
      let tempInPrice = getValocorePrice(underlying.id);
      createPriceFeed(vault, tempInPrice, block);
      return tempInPrice
    }

    if (isBalancer(underlying.name)) {
      const tempPrice = getPriceForBalancer(underlying.id);
      createPriceFeed(vault, tempPrice, block);
      return tempPrice
    }

    if (isSyncSwap(underlying.name)) {
      const tempPrice = getPriceForSyncSwap(underlying.id);
      createPriceFeed(vault, tempPrice, block);
      return tempPrice
    }

    if (isCurve(underlying.name)) {
      const tempPrice = getPriceForCurve(underlying.id)
      createPriceFeed(vault, tempPrice, block);
      return tempPrice;
    }
  }

  return BigDecimal.zero()
}

export function getPriceLpUniPair(underlyingAddress: string): BigDecimal {
  const uniswapV2Pair = SwapSyncPoolContract.bind(Address.fromString(underlyingAddress))
  const tryGetReserves = uniswapV2Pair.try_getReserves()
  if (tryGetReserves.reverted) {
    log.log(log.Level.WARNING, `Can not get reserves for underlyingAddress = ${underlyingAddress}, try get price for coin`)

    return getPriceForCoin(Address.fromString(underlyingAddress)).divDecimal(BD_18)
  }
  const reserves = tryGetReserves.value
  const totalSupply = uniswapV2Pair.totalSupply()
  const positionFraction = BD_ONE.div(totalSupply.toBigDecimal().div(BD_18))

  const token0 = uniswapV2Pair.token0()
  const token1 = uniswapV2Pair.token1()

  const firstCoin = reserves.get_reserve0().toBigDecimal().times(positionFraction)
    .div(pow(BD_TEN, fetchContractDecimal(token0).toI32()))
  const secondCoin = reserves.get_reserve1().toBigDecimal().times(positionFraction)
    .div(pow(BD_TEN, fetchContractDecimal(token1).toI32()))

  // const firstCoin = reserves.get_reserve0().toBigDecimal().times(positionFraction)
  //   .div(BD_18)
  // const secondCoin = reserves.get_reserve1().toBigDecimal().times(positionFraction)
  //   .div(BD_18)

  const token0Price = getPriceForCoin(token0)
  const token1Price = getPriceForCoin(token1)

  if (token0Price.isZero() || token1Price.isZero()) {
    log.log(log.Level.WARNING, `Some price is zero token0 ${token0.toHex()} = ${token0Price} , token1 ${token1.toHex()} = ${token1Price}`)
    return BigDecimal.zero()
  }

  return token0Price
    .divDecimal(BD_18)
    .times(firstCoin)
    .plus(
      token1Price
        .divDecimal(BD_18)
        .times(secondCoin)
    )
}

export function getValocorePrice(underlyingAddress: string): BigDecimal {
  const velocorePool = VelocorePoolContract.bind(VELOCORE_FACTORY)
  const tryQueryPool = velocorePool.try_queryPool(Address.fromString(underlyingAddress));
  if (tryQueryPool.reverted) {
    log.log(log.Level.WARNING, `Can not get pool for underlyingAddress = ${underlyingAddress}, try get price for coin`)

    return getPriceForCoin(Address.fromString(underlyingAddress)).divDecimal(BD_18)
  }

  const queryPool = tryQueryPool.value
  let token0Address = '0x' + queryPool.listedTokens[0].toHexString().substr(queryPool.listedTokens[0].toHexString().length - 40, queryPool.listedTokens[0].toHexString().length - 1);
  let token1Address = '0x' + queryPool.listedTokens[1].toHexString().substr(queryPool.listedTokens[1].toHexString().length - 40, queryPool.listedTokens[1].toHexString().length - 1);

  if (token0Address == '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    token0Address = WETH_ZK.toHexString()
  }

  if (token1Address == '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    token1Address = WETH_ZK.toHexString()
  }

  const token0 = Address.fromString(token0Address);
  const token1 = Address.fromString(token1Address);

  const token0Price = getPriceForCoin(token0)
  const token1Price = getPriceForCoin(token1)

  const decimals0 = fetchContractDecimal(token0).toI32()
  const decimals1 = fetchContractDecimal(token1).toI32()
  const decimal = fetchContractDecimal(Address.fromString(underlyingAddress)).toI32()

  const token0Amount = queryPool.reserves[0].divDecimal(pow(BD_TEN, decimals0))
  const token1Amount = queryPool.reserves[1].divDecimal(pow(BD_TEN, decimals1))

  const totalSupply = queryPool.mintedLPTokens[0].divDecimal(pow(BD_TEN, decimal))



  if (token0Price.isZero() || token1Price.isZero()) {
    log.log(log.Level.WARNING, `Some price is zero token0 ${token0.toHex()} = ${token0Price} , token1 ${token1.toHex()} = ${token1Price}`)
    return BigDecimal.zero()
  }

  const value = token0Amount.times(token0Price.divDecimal(BD_18)).plus(token1Amount.times(token1Price.divDecimal(BD_18)));


  return value.div(totalSupply);
}

export function getPriceForSyncSwap(underlying: string): BigDecimal {
  const pool = SwapSyncPoolContract.bind(Address.fromString(underlying));
  const tryToken0 = pool.try_token0();
  const tryToken1 = pool.try_token1();
  if (tryToken0.reverted || tryToken1.reverted) {
    return BigDecimal.zero();
  }
  const token0 = tryToken0.value;
  const token1 = tryToken1.value;

  const token0Price = getPriceForCoin(token0);
  const token1Price = getPriceForCoin(token1);

  if (token0Price.isZero()) {
    log.log(log.Level.WARNING, `Can not get price for token0 = ${token0.toHex()} , underlying = ${underlying}`);
    return BigDecimal.zero();
  }

  if (token1Price.isZero()) {
    log.log(log.Level.WARNING, `Can not get price for token1 = ${token1.toHex()} , underlying = ${underlying}`);
    return BigDecimal.zero();
  }

  const decimals0 = fetchContractDecimal(token0).toI32();
  const decimals1 = fetchContractDecimal(token1).toI32();
  // const decimals = fetchContractDecimal(Address.fromString(underlying)).toI32();

  const tryReserves = pool.try_getReserves();
  if (tryReserves.reverted) {
    log.log(log.Level.WARNING, `Can not get reserves for underlying = ${underlying}`);
    return BigDecimal.zero();
  }

  const reserves = tryReserves.value;

  const tryTotalSupply = pool.try_totalSupply();
  if (tryTotalSupply.reverted) {
    log.log(log.Level.WARNING, `Can not get totalSupply for underlying = ${underlying}`);
    return BigDecimal.zero();
  }

  const totalSupply = tryTotalSupply.value.toBigDecimal().div(pow(BD_TEN, DEFAULT_DECIMAL + decimals0 - decimals1));

  const token0Amount = reserves.get_reserve0().toBigDecimal().div(pow(BD_TEN, decimals0));
  const token1Amount = reserves.get_reserve1().toBigDecimal().div(pow(BD_TEN, decimals1));

  const totalValue = token0Amount.times(token0Price.divDecimal(pow(BD_TEN, decimals0))).plus(token1Amount.times(token1Price.divDecimal(pow(BD_TEN, decimals1))));

  return totalValue.div(totalSupply);
}

export function getPriceForBalancer(underlying: string): BigDecimal {
  const balancer = WeightedPool2TokensContract.bind(Address.fromString(underlying))
  const poolId = balancer.getPoolId()
  const totalSupply = balancer.totalSupply()
  const vault = BalancerVaultContract.bind(balancer.getVault())
  const tokenInfo = vault.getPoolTokens(poolId)

  let price = BigDecimal.zero()
  for (let i=0;i<tokenInfo.getTokens().length;i++) {
    const tokenAddress = tokenInfo.getTokens()[i]
    const tryDecimals = ERC20.bind(tokenAddress).try_decimals()
    let decimal = DEFAULT_DECIMAL
    if (!tryDecimals.reverted) {
      decimal = tryDecimals.value
    }
    const balance = normalizePrecision(tokenInfo.getBalances()[i], BigInt.fromI32(decimal)).toBigDecimal()

    let tokenPrice = BD_ZERO;
    if (tokenAddress == Address.fromString(underlying)) {
      tokenPrice = BD_ONE;
    } else if (checkBalancer(tokenAddress)) {
      tokenPrice = getPriceForBalancer(tokenAddress.toHexString());
    } else {
      tokenPrice = getPriceForCoin(tokenAddress).divDecimal(BD_18)
    }

    price = price.plus(balance.times(tokenPrice))
  }

  if (price.le(BigDecimal.zero())) {
    return price
  }
  return price.div(totalSupply.toBigDecimal())
}

export function toBigInt(value: BigDecimal): BigInt {
  const val = value.toString().split('.');
  if (val.length < 1) {
    return BigInt.zero();
  }
  return BigInt.fromString(val[0])
}


export function getPriceForCurve(underlyingAddress: string): BigDecimal {
  const curveContract = CurveVaultContract.bind(Address.fromString(underlyingAddress))
  const tryMinter = curveContract.try_minter()

  let minter = CurveMinterContract.bind(Address.fromString(underlyingAddress))
  if (!tryMinter.reverted) {
    minter = CurveMinterContract.bind(tryMinter.value)
  }

  let index = 0
  let tryCoins = minter.try_coins(BigInt.fromI32(index))
  while (!tryCoins.reverted) {
    const coin = tryCoins.value
    if (coin.equals(Address.zero())) {
      index = index - 1
      break
    }
    index = index + 1
    tryCoins = minter.try_coins(BigInt.fromI32(index))
  }
  const tryDecimals = curveContract.try_decimals()
  let decimal = DEFAULT_DECIMAL
  if (!tryDecimals.reverted) {
    decimal = tryDecimals.value.toI32()
  } else {
    log.log(log.Level.WARNING, `Can not get decimals for ${underlyingAddress}`)
  }
  const size = index + 1
  if (size < 1) {
    return BigDecimal.zero()
  }

  let value = BigDecimal.zero()

  for (let i=0;i<size;i++) {
    const index = BigInt.fromI32(i)
    const tryCoins1 = minter.try_coins(index)
    if (tryCoins1.reverted) {
      break
    }
    const token = tryCoins1.value
    const tokenPrice = getPriceForCoin(token).divDecimal(BD_18)
    const balance = minter.balances(index)
    const tryDecimalsTemp = ERC20.bind(token).try_decimals()
    let decimalsTemp = DEFAULT_DECIMAL
    if (!tryDecimalsTemp.reverted) {
      decimalsTemp = tryDecimalsTemp.value
    } else {
      log.log(log.Level.WARNING, `Can not get decimals for ${token}`)
    }
    const tempBalance = balance.toBigDecimal().div(pow(BD_TEN, decimalsTemp))

    value = value.plus(tokenPrice.times(tempBalance))
  }
  return value.times(BD_18).div(curveContract.totalSupply().toBigDecimal())
}


function normalizePrecision(amount: BigInt, decimal: BigInt): BigInt {
  return amount.div(BI_18.div(BigInt.fromI64(10 ** decimal.toI64())))
}