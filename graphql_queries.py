GET_DAY_AHEAD_PRICES = """
query getDayAheadPrices($accountNumber: String!) {
  account(accountNumber: $accountNumber) {
    properties { electricityMalos { agreements { unitRateForecast {
      validFrom unitRateInformation { ... on TimeOfUseProductUnitRateInformation {
        rates { latestGrossUnitRateCentsPerKwh }
      } }
    } } } } 
  }
}
"""

GET_USAGE = """
query getUsage($account: String!, $date: Date!) {
  account(accountNumber: $account) {
    properties { measurements(utilityFilters: { electricityFilters: { readingFrequencyType: RAW_INTERVAL, readingQuality: COMBINED } }, startOn: $date, first: 100) {
      edges { node { ... on IntervalMeasurementType { startAt value } } }
    } }
  }
}
"""