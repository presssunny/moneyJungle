import { prisma } from "../../config/database";
import { defaultCategories } from "./defaultCategories.seed";
import { defaultCategoryRules } from "./defaultCategoryRules.seed";
import { defaultPaymentMethods } from "./defaultPaymentMethods.seed";
import { fixedPlanRows } from "./fixedPlan.seed";

async function main() {
  // Primary user + settings
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({ data: { name: "המשפחה שלי" } });
    console.log("Created primary user");
  }

  await prisma.settings.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });

  // Default categories (system-wide, userId = null)
  for (const category of defaultCategories) {
    const existing = await prisma.category.findFirst({
      where: { name: category.name, userId: null },
    });
    if (!existing) {
      await prisma.category.create({
        data: { ...category, userId: null, isDefault: true },
      });
    } else if (existing.color !== category.color || existing.icon !== category.icon) {
      await prisma.category.update({
        where: { id: existing.id },
        data: { color: category.color, icon: category.icon },
      });
    }
  }
  console.log(`Categories seeded (${defaultCategories.length})`);

  // Default payment methods
  for (const method of defaultPaymentMethods) {
    const existing = await prisma.paymentMethod.findFirst({
      where: { name: method.name, userId: null },
    });
    if (!existing) {
      await prisma.paymentMethod.create({
        data: { ...method, userId: null, isDefault: true },
      });
    }
  }
  console.log(`Payment methods seeded (${defaultPaymentMethods.length})`);

  // Default categorization rules
  const categories = await prisma.category.findMany({ where: { userId: null } });
  const categoryByName = new Map(categories.map((c) => [c.name, c.id]));

  for (const rule of defaultCategoryRules) {
    const categoryId = categoryByName.get(rule.categoryName);
    if (!categoryId) {
      console.warn(`Skipping rule "${rule.keyword}" — category "${rule.categoryName}" not found`);
      continue;
    }
    const existing = await prisma.categoryRule.findFirst({
      where: { keyword: rule.keyword, userId: null },
    });
    if (!existing) {
      await prisma.categoryRule.create({
        data: { keyword: rule.keyword, categoryId, userId: null },
      });
    }
  }
  console.log(`Category rules seeded (${defaultCategoryRules.length})`);

  // The family's fixed monthly plan (from their Excel) as recurring payments
  const existingRecurring = await prisma.recurringPayment.count({ where: { userId: user.id } });
  if (existingRecurring === 0) {
    const methods = await prisma.paymentMethod.findMany({ where: { userId: null } });
    const methodByName = new Map(methods.map((m) => [m.name, m.id]));
    const now = new Date();
    const nextMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };

    for (const row of fixedPlanRows) {
      await prisma.recurringPayment.create({
        data: {
          userId: user.id,
          name: row.name,
          amount: row.amount,
          categoryId: categoryByName.get(row.categoryName) ?? null,
          paymentMethodId: methodByName.get(row.paymentMethodName) ?? null,
          frequency: "monthly",
          nextPaymentDate: new Date(Date.UTC(nextMonth.year, nextMonth.month - 1, row.day)),
        },
      });
    }
    console.log(`Fixed monthly plan seeded (${fixedPlanRows.length} recurring payments)`);
  } else {
    console.log("Fixed monthly plan already present — skipped");
  }

  console.log("Seed completed ✔");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
