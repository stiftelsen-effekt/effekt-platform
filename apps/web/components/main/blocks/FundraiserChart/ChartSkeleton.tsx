import style from "./ChartSkeleton.module.scss";

export const FundraiserChartSkeleton: React.FC<{ numberOfFundraisers: number }> = ({
  numberOfFundraisers,
}) => {
  const bars = [];

  for (let i = 0; i < numberOfFundraisers; i++) {
    bars.push(
      <div
        key={i}
        className={style.fundraiserBar}
        style={{
          width: `${((numberOfFundraisers - i) / numberOfFundraisers) * 90 + 10}%`,
        }}
      />,
    );
  }

  return <div className={style.wrapper}>{bars}</div>;
};
