import { describe, test, assert, createMockedFunction, dataSourceMock } from 'matchstick-as/assembly/index';
import { getPriceLpUniPair } from '../../src/utils/PriceUtils';
import { Address, BigDecimal, ethereum, log, BigInt } from '@graphprotocol/graph-ts';
import { isLpUniPair } from '../../src/utils/PlatformUtils';

describe('Check price', () => {
  test('Is lp pool', () => {
    const result = isLpUniPair('ZF LONG/WETH LP Token')
    assert.assertTrue(result);
  });

  test('Should return correct price for ZF USDC/USDT LP Token', () => {
    const underlying = '0xd32b34bc9690322c609c1cc15f88e440e73ce2db';
    const underlyingAddress = Address.fromString(underlying);

    createMockedFunction(underlyingAddress, 'getReserves', 'getReserves():(uint112,uint112)')
      .returns([
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString('26990535753519829458')),
        ethereum.Value.fromUnsignedBigInt(BigInt.fromString('1300457263436280126139')),
      ])

    const price = getPriceLpUniPair(underlying);
    // const price = BigDecimal.fromString('39060801479589884141')
    log.log(log.Level.INFO, `price = ${price}`)

    assert.assertTrue(price.equals(BigDecimal.fromString('39060801479589884141')))
  });
})