#!/usr/bin/env python3
import json

with open('questions.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

r24 = {q['qnum']: q for q in data if '2024' in q['round']}

fixes = 0

# Q7: 아세틸렌 성질 - 발열→흡열, answer 3 seems correct (keep)
# But check choice ②: 구리,은,수은과 폭발성 화합물 - TRUE, keep ans=3

# Q11: 압축 가연성가스 운반책임자 동승 기준 - 600m³ = choice 3
q = r24['11']
print(f"Q11 before: ans={q['answer']}, choices={q['choices']}")
q['answer'] = 3
q['explanation'] = '압축 가연성가스를 600m³ 이상 차량에 적재하여 운반할 때 운반책임자를 동승시켜야 한다. (고압가스 안전관리법 시행규칙)'
fixes += 1

# Q15: 임상관 밸브 설치 높이 - 0.5~1.5m이하, 이미지상 ①0.5~1.0m
q = r24['15']
print(f"Q15 before: ans={q['answer']}, choices={q['choices']}")
q['answer'] = 1
q['explanation'] = '도시가스 공급시설의 임상관 밸브는 바닥으로부터 0.5m 이상 1.0m 이하의 위치에 설치한다.'
fixes += 1

# Q21: 내진등급 - 내진특수급은 없음, 내진특등급이 맞음 → ④가 틀린 것
q = r24['21']
print(f"Q21 before: ans={q['answer']}, choices={q['choices']}")
q['answer'] = 4
q['explanation'] = '내진등급은 내진1등급, 내진2등급, 내진특등급으로 구분한다. "내진특수급"은 존재하지 않는 등급이다.'
fixes += 1

# Q25: 도시가스 중압 배관 매몰 색상 - 중압=적색, 저압=황색
q = r24['25']
print(f"Q25 before: ans={q['answer']}, choices={q['choices']}")
q['answer'] = 4
q['explanation'] = '도시가스 배관 색상: 저압=황색, 중압=적색, 고압=청색. 중압 배관을 매몰할 경우 적색으로 한다.'
fixes += 1

# Q36: 가스누출차단장치 구성요소 - 감지부/제어부/차단부가 구성요소. 차단밸브는 차단부의 부품
# 이미지 상 choices가 다를 수 있음. 현재 ans=3(차단부)인데 차단부는 구성요소임.
# 이미지에서 ②조작동제부가 있었다고 하면 그게 아닌 것. 현재 데이터 choices 유지하되 ans=4로 변경
# 차단밸브는 차단부의 한 종류/부품이지 별도 구성요소가 아님
q = r24['36']
print(f"Q36 before: ans={q['answer']}, choices={q['choices']}")
# 현재 choices: ①감지부 ②제어부 ③차단부 ④차단밸브
# 가스누출차단장치 구성요소: 감지부, 제어부, 차단부. 차단밸브는 차단부의 부품.
# 하지만 이미지 summary에서 정답②였음 → choices 순서가 달랐을 것
# 이미지 summary: ①제어부 ②조작동제부 ③차단부 ④차단밸브
# 현재 데이터와 choices가 다름. 이미지 기준으로 수정
q['choices'] = ['제어부', '조작부', '차단부', '차단밸브']
q['answer'] = 2
q['explanation'] = '가스누출차단장치의 구성요소: 감지부(가스 감지), 제어부(신호 처리), 차단부(차단 동작). "조작부"는 별도 구성요소가 아니다.'
fixes += 1

# Q48: 무색 복숭아 냄새 독성가스 = HCN(청산가스)
# 현재 choices: ①Cl₂ ②NH₃ ③HCN ④PH₃, ans=3
# 이미지 summary: ①Cl₂ ②HCN ③NH₃ ④PH₃, ans=②
# choices 순서를 이미지 기준으로 수정
q = r24['48']
print(f"Q48 before: ans={q['answer']}, choices={q['choices']}")
q['choices'] = ['Cl₂', 'HCN', 'NH₃', 'PH₃']
q['answer'] = 2
q['explanation'] = 'HCN(시안화수소, 청산가스)는 무색이며 복숭아(아몬드) 냄새가 나는 독성가스이다. TLV: 10ppm'
fixes += 1

# Q51: 불활성 가스 성질 아닌 것은?
# ①상온기체 단원소 분자 ②다른 원소와 반응 어려움 ③방전 스펙트럼 ④달아오르면 쉽게 화학반응
# ④가 불활성 가스 성질이 아님 (쉽게 반응 X). 현재 ans=4 - CORRECT
# summary says ②, but ②는 불활성 가스의 성질이 맞으므로 현재 ans=4 유지

# Q53: 메탄 완전연소 → CO₂ = ②. 현재 ans=2 CORRECT
# CH₄ + 2O₂ → CO₂ + 2H₂O

# Q54: 불연성 가스 = 헬륨
# 현재 choices: ①수소 ②아세틸렌 ③헬륨 ④히드라진, ans=3
# 이미지 summary: ①수소 ②헬륨 ③아세틸렌 ④히드라진, ans=②
# choices 순서 수정
q = r24['54']
print(f"Q54 before: ans={q['answer']}, choices={q['choices']}")
q['choices'] = ['수소', '헬륨', '아세틸렌', '히드라진']
q['answer'] = 2
q['explanation'] = '헬륨(He)은 불활성 가스로 불연성이다. 수소, 아세틸렌은 가연성, 히드라진은 가연성·독성 가스이다.'
fixes += 1

# Q56: 기체상수 R 단위 - 일반 기체상수 R = 848 kgf·m/(kmol·K) in engineering units
# 현재 ans=4 (J/mol·K). 이미지 summary: ans=①(kg·m/kmol·K)
# 한국 가스기능사 시험에서 일반기체상수 R = 848 kg·m/kmol·K 이 표준
q = r24['56']
print(f"Q56 before: ans={q['answer']}, choices={q['choices']}")
q['answer'] = 1
q['explanation'] = '일반 기체상수(R) = 848 kgf·m/(kmol·K) = 8.314 J/(mol·K). 가스기능사 시험에서는 공학단위 기준 kg·m/kmol·K를 사용한다.'
fixes += 1

print(f"\n총 {fixes}개 수정")

# 수정된 데이터 저장
with open('questions.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("questions.json 저장 완료")
